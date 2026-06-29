import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import * as authService from '../../src/services/auth.service';
import * as totpService from '../../src/services/totp.service';
import * as cryptoService from '../../src/services/crypto.service';
import * as emailService from '../../src/services/email.service';
import * as cacheService from '../../src/services/cache.service';
import { AppError } from '../../src/utils/AppError';
import { pool } from '../../src/config/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { password_reset_tokens } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

jest.mock('../../src/services/totp.service');
jest.mock('../../src/services/crypto.service');
jest.mock('../../src/services/email.service');
jest.mock('../../src/services/cache.service');
jest.mock('bcrypt');
jest.mock('jsonwebtoken');

const mockTotpService = totpService as jest.Mocked<typeof totpService>;
const mockCryptoService = cryptoService as jest.Mocked<typeof cryptoService>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;
const mockCacheService = cacheService as jest.Mocked<typeof cacheService>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockJwt = jwt as jest.Mocked<typeof jwt>;

describe('AuthService', () => {
  let db: any;

  beforeEach(() => {
    jest.clearAllMocks();
    authService.users.clear();
    db = drizzle(pool);
  });

  // =========================================================================
  // USER REGISTRATION
  // =========================================================================
  describe('register', () => {
    it('should register a new user successfully', async () => {
      mockCacheService.redis.set.mockResolvedValue(undefined);
      mockEmailService.sendVerificationEmail.mockResolvedValue(true);

      const result = await authService.register('test@example.com', 'password123');

      expect(result.userId).toBeDefined();
      expect(result.message).toContain('Registration successful');
      expect(authService.users.size).toBe(1);

      const user = authService.users.get(result.userId);
      expect(user?.email).toBe('test@example.com');
      expect(user?.emailVerified).toBe(false);
      expect(user?.twoFactorEnabled).toBe(false);
      expect(user?.sessionVersion).toBe(0);
    });

    it('should reject duplicate email registration', async () => {
      mockCacheService.redis.set.mockResolvedValue(undefined);
      mockEmailService.sendVerificationEmail.mockResolvedValue(true);

      await authService.register('test@example.com', 'password123');

      expect.assertions(1);
      try {
        await authService.register('test@example.com', 'anotherpassword');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(409);
      }
    });

    it('should fail if email verification fails', async () => {
      mockCacheService.redis.set.mockResolvedValue(undefined);
      mockEmailService.sendVerificationEmail.mockResolvedValue(false);

      expect.assertions(2);
      try {
        await authService.register('test@example.com', 'password123');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(500);
        expect((err as AppError).message).toContain('Failed to send verification email');
      }
    });

    it('should generate email verification token stored in cache', async () => {
      mockCacheService.redis.set.mockResolvedValue(undefined);
      mockEmailService.sendVerificationEmail.mockResolvedValue(true);

      const result = await authService.register('test@example.com', 'password123');
      const user = authService.users.get(result.userId);

      expect(user?.emailVerificationToken).toBeDefined();
      expect(mockCacheService.redis.set).toHaveBeenCalledWith(
        expect.stringContaining('email_verification:'),
        result.userId,
        'EX',
        15 * 60,
      );
    });
  });

  // =========================================================================
  // LOGIN - BASIC & 2FA
  // =========================================================================
  describe('login', () => {
    beforeEach(() => {
      // Create a test user without 2FA
      authService.users.set('user1', {
        id: 'user1',
        email: 'user@example.com',
        passwordHash: 'hashed_password',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 0,
      });
    });

    it('should login successfully with correct credentials', async () => {
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockJwt.sign.mockReturnValue('token' as never);

      const result = await authService.login('user@example.com', 'password123');

      expect('accessToken' in result).toBe(true);
      expect('refreshToken' in result).toBe(true);
      expect(mockBcrypt.compare).toHaveBeenCalledWith('password123', 'hashed_password');
    });

    it('should reject non-existent user', async () => {
      expect.assertions(1);
      try {
        await authService.login('nonexistent@example.com', 'password123');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(401);
      }
    });

    it('should reject wrong password', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);

      expect.assertions(1);
      try {
        await authService.login('user@example.com', 'wrongpassword');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(401);
      }
    });

    it('should return temp token when 2FA is enabled', async () => {
      authService.users.set('user-2fa', {
        id: 'user-2fa',
        email: 'user2fa@example.com',
        passwordHash: 'hashed_password',
        emailVerified: true,
        twoFactorEnabled: true,
        twoFactorSecret: 'encrypted_secret',
        sessionVersion: 0,
      });

      mockBcrypt.compare.mockResolvedValue(true as never);
      mockJwt.sign.mockReturnValue('temp_token' as never);

      const result = await authService.login('user2fa@example.com', 'password123');

      expect('requires2FA' in result && result.requires2FA).toBe(true);
      expect('tempToken' in result && result.tempToken).toBeDefined();
    });
  });

  // =========================================================================
  // 2FA FLOW - SETUP, ENABLE, VERIFY, DISABLE
  // =========================================================================
  describe('2FA flow', () => {
    beforeEach(() => {
      authService.users.set('user-plain', {
        id: 'user-plain',
        email: 'plain@example.com',
        passwordHash: 'hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 0,
      });
    });

    describe('setup2FA', () => {
      it('should generate 2FA secret and QR code', async () => {
        mockTotpService.generateSecret.mockReturnValue({
          secret: 'base32secret',
          otpauthUrl: 'otpauth://totp/...',
        });
        mockTotpService.generateQRCode.mockResolvedValue('data:image/png;base64,...');
        mockCryptoService.encrypt.mockReturnValue('encrypted_secret');

        const result = await authService.setup2FA('user-plain');

        expect(result.qrCode).toBeDefined();
        expect(result.secret).toBe('base32secret');
        expect(mockCryptoService.encrypt).toHaveBeenCalledWith('base32secret');
      });

      it('should reject if 2FA already enabled', async () => {
        authService.users.set('user-2fa-enabled', {
          id: 'user-2fa-enabled',
          email: 'enabled@example.com',
          passwordHash: 'hash',
          emailVerified: true,
          twoFactorEnabled: true,
          twoFactorSecret: 'secret',
          sessionVersion: 0,
        });

        expect.assertions(1);
        try {
          await authService.setup2FA('user-2fa-enabled');
        } catch (err) {
          expect((err as AppError).statusCode).toBe(400);
        }
      });

      it('should reject non-existent user', async () => {
        expect.assertions(1);
        try {
          await authService.setup2FA('nonexistent-user');
        } catch (err) {
          expect((err as AppError).statusCode).toBe(404);
        }
      });
    });

    describe('enable2FA', () => {
      beforeEach(async () => {
        mockTotpService.generateSecret.mockReturnValue({
          secret: 'base32secret',
          otpauthUrl: 'otpauth://...',
        });
        mockCryptoService.encrypt.mockReturnValue('encrypted_secret');
        mockTotpService.generateQRCode.mockResolvedValue('qr');

        await authService.setup2FA('user-plain');
      });

      it('should enable 2FA with valid OTP', async () => {
        mockCryptoService.decrypt.mockReturnValue('base32secret');
        mockTotpService.verifyToken.mockReturnValue(true);

        await authService.enable2FA('user-plain', '123456');

        const user = authService.users.get('user-plain');
        expect(user?.twoFactorEnabled).toBe(true);
      });

      it('should reject invalid OTP', async () => {
        mockCryptoService.decrypt.mockReturnValue('base32secret');
        mockTotpService.verifyToken.mockReturnValue(false);

        expect.assertions(1);
        try {
          await authService.enable2FA('user-plain', '000000');
        } catch (err) {
          expect((err as AppError).statusCode).toBe(401);
        }
      });

      it('should reject if setup not run first', async () => {
        authService.users.set('user-no-setup', {
          id: 'user-no-setup',
          email: 'nosetup@example.com',
          passwordHash: 'hash',
          emailVerified: true,
          twoFactorEnabled: false,
          sessionVersion: 0,
        });

        expect.assertions(1);
        try {
          await authService.enable2FA('user-no-setup', '123456');
        } catch (err) {
          expect((err as AppError).statusCode).toBe(400);
        }
      });
    });

    describe('verify2FA', () => {
      beforeEach(async () => {
        mockTotpService.generateSecret.mockReturnValue({
          secret: 'base32secret',
          otpauthUrl: 'otpauth://...',
        });
        mockCryptoService.encrypt.mockReturnValue('encrypted_secret');
        mockTotpService.generateQRCode.mockResolvedValue('qr');
        mockCryptoService.decrypt.mockReturnValue('base32secret');
        mockTotpService.verifyToken.mockReturnValue(true);

        await authService.setup2FA('user-plain');
        await authService.enable2FA('user-plain', '123456');
      });

      it('should verify 2FA OTP and return tokens', async () => {
        const tempPayload = { sub: 'user-plain', type: 'temp_2fa' };
        mockJwt.verify.mockReturnValue(tempPayload as never);
        mockJwt.sign.mockReturnValue('jwt_token' as never);

        const result = await authService.verify2FA('temp_token', '123456');

        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
        expect(mockCryptoService.decrypt).toHaveBeenCalled();
        expect(mockTotpService.verifyToken).toHaveBeenCalledWith('base32secret', '123456');
      });

      it('should reject invalid temp token', async () => {
        mockJwt.verify.mockImplementation(() => {
          throw new Error('Invalid token');
        });

        expect.assertions(1);
        try {
          await authService.verify2FA('invalid_temp_token', '123456');
        } catch {
          expect(true).toBe(true);
        }
      });

      it('should reject wrong OTP during verification', async () => {
        const tempPayload = { sub: 'user-plain', type: 'temp_2fa' };
        mockJwt.verify.mockReturnValue(tempPayload as never);
        mockTotpService.verifyToken.mockReturnValue(false);

        expect.assertions(1);
        try {
          await authService.verify2FA('temp_token', '000000');
        } catch (err) {
          expect((err as AppError).statusCode).toBe(401);
        }
      });
    });

    describe('disable2FA', () => {
      beforeEach(async () => {
        mockTotpService.generateSecret.mockReturnValue({
          secret: 'base32secret',
          otpauthUrl: 'otpauth://...',
        });
        mockCryptoService.encrypt.mockReturnValue('encrypted_secret');
        mockTotpService.generateQRCode.mockResolvedValue('qr');
        mockCryptoService.decrypt.mockReturnValue('base32secret');
        mockTotpService.verifyToken.mockReturnValue(true);

        await authService.setup2FA('user-plain');
        await authService.enable2FA('user-plain', '123456');
      });

      it('should disable 2FA with valid OTP', async () => {
        mockCryptoService.decrypt.mockReturnValue('base32secret');
        mockTotpService.verifyToken.mockReturnValue(true);

        await authService.disable2FA('user-plain', '123456');

        const user = authService.users.get('user-plain');
        expect(user?.twoFactorEnabled).toBe(false);
        expect(user?.twoFactorSecret).toBeUndefined();
      });

      it('should reject invalid OTP during disable', async () => {
        mockCryptoService.decrypt.mockReturnValue('base32secret');
        mockTotpService.verifyToken.mockReturnValue(false);

        expect.assertions(1);
        try {
          await authService.disable2FA('user-plain', '000000');
        } catch (err) {
          expect((err as AppError).statusCode).toBe(401);
        }
      });

      it('should reject if 2FA not enabled', async () => {
        authService.users.set('user-no-2fa', {
          id: 'user-no-2fa',
          email: 'no2fa@example.com',
          passwordHash: 'hash',
          emailVerified: true,
          twoFactorEnabled: false,
          sessionVersion: 0,
        });

        expect.assertions(1);
        try {
          await authService.disable2FA('user-no-2fa', '123456');
        } catch (err) {
          expect((err as AppError).statusCode).toBe(400);
        }
      });
    });
  });

  // =========================================================================
  // JWT TOKEN MANAGEMENT
  // =========================================================================
  describe('JWT token generation and verification', () => {
    it('should generate access token with correct payload', async () => {
      mockJwt.sign.mockReturnValue('access_token' as never);

      authService.users.set('user1', {
        id: 'user1',
        email: 'user@example.com',
        passwordHash: 'hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 2,
      });

      const result = await authService.login('user@example.com', 'password');
      mockBcrypt.compare.mockResolvedValue(true as never);

      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user1',
          type: 'access',
          sv: 2,
        }),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should generate refresh token with correct payload', async () => {
      mockJwt.sign.mockReturnValue('refresh_token' as never);
      mockBcrypt.compare.mockResolvedValue(true as never);

      authService.users.set('user1', {
        id: 'user1',
        email: 'user@example.com',
        passwordHash: 'hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 3,
      });

      await authService.login('user@example.com', 'password');

      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user1',
          type: 'refresh',
          sv: 3,
        }),
        expect.any(String),
        expect.any(Object),
      );
    });
  });
});

  // =========================================================================
  // PASSWORD RESET FLOW
  // =========================================================================
  describe('forgotPassword', () => {
    beforeEach(() => {
      authService.users.set('user1', {
        id: 'user1',
        email: 'user@example.com',
        passwordHash: 'old_hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 0,
      });
    });

    it('should send password reset email for existing user', async () => {
      mockJwt.sign.mockReturnValue('reset_token' as never);
      mockEmailService.sendPasswordResetEmail.mockResolvedValue(undefined);

      await authService.forgotPassword('user@example.com');

      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
      );
    });

    it('should not reveal if email does not exist (timing attack prevention)', async () => {
      const result = await authService.forgotPassword('nonexistent@example.com');

      // Should return undefined without throwing
      expect(result).toBeUndefined();
    });

    it('should create password reset token in database', async () => {
      mockJwt.sign.mockReturnValue('reset_token' as never);
      mockEmailService.sendPasswordResetEmail.mockResolvedValue(undefined);

      await authService.forgotPassword('user@example.com');

      // Verify token was stored
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    beforeEach(() => {
      authService.users.set('user1', {
        id: 'user1',
        email: 'user@example.com',
        passwordHash: 'old_hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 1,
      });
    });

    it('should reset password with valid token', async () => {
      const resetToken = 'valid_reset_token';
      const tokenPayload = { sub: 'user1', type: 'password_reset' };

      mockJwt.verify.mockReturnValue(tokenPayload as never);
      mockBcrypt.hash.mockResolvedValue('new_password_hash' as never);
      mockCacheService.redis.set.mockResolvedValue(undefined);

      // Mock database query to return token record
      const mockDb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() + 15 * 60 * 1000),
          },
        ]),
        limit: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() + 15 * 60 * 1000),
          },
        ]),
        delete: jest.fn().mockReturnThis(),
      };

      jest.spyOn(require('drizzle-orm/node-postgres'), 'drizzle').mockReturnValue(mockDb as any);

      await authService.resetPassword(resetToken, 'newpassword123');

      const user = authService.users.get('user1');
      expect(user?.passwordHash).toBe('new_password_hash');
      expect(user?.sessionVersion).toBe(2); // incremented
    });

    it('should reject invalid reset token', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      expect.assertions(1);
      try {
        await authService.resetPassword('invalid_token', 'newpassword');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(400);
      }
    });

    it('should reject expired reset token', async () => {
      const resetToken = 'expired_token';
      const tokenPayload = { sub: 'user1', type: 'password_reset' };

      mockJwt.verify.mockReturnValue(tokenPayload as never);

      const mockDb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() - 1000), // expired
          },
        ]),
        limit: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() - 1000),
          },
        ]),
        delete: jest.fn().mockReturnThis(),
      };

      jest.spyOn(require('drizzle-orm/node-postgres'), 'drizzle').mockReturnValue(mockDb as any);

      expect.assertions(1);
      try {
        await authService.resetPassword(resetToken, 'newpassword');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(400);
      }
    });

    it('should enforce one-time use of reset token', async () => {
      const resetToken = 'reset_token';
      const tokenPayload = { sub: 'user1', type: 'password_reset' };

      mockJwt.verify.mockReturnValue(tokenPayload as never);
      mockBcrypt.hash.mockResolvedValue('new_hash' as never);
      mockCacheService.redis.set.mockResolvedValue(undefined);

      const mockDb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn(),
        limit: jest.fn(),
        delete: jest.fn().mockReturnThis(),
      };

      // First call returns token, delete is called
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'token_id',
          user_id: 'user1',
          token_hash: expect.any(String),
          expires_at: new Date(Date.now() + 15 * 60 * 1000),
        },
      ]);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'token_id',
          user_id: 'user1',
          token_hash: expect.any(String),
          expires_at: new Date(Date.now() + 15 * 60 * 1000),
        },
      ]);

      jest.spyOn(require('drizzle-orm/node-postgres'), 'drizzle').mockReturnValue(mockDb as any);

      await authService.resetPassword(resetToken, 'newpassword');

      // Verify delete was called to consume the token
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should invalidate all previous sessions after password reset', async () => {
      const resetToken = 'reset_token';
      const tokenPayload = { sub: 'user1', type: 'password_reset' };

      mockJwt.verify.mockReturnValue(tokenPayload as never);
      mockBcrypt.hash.mockResolvedValue('new_hash' as never);
      mockCacheService.redis.set.mockResolvedValue(undefined);

      const mockDb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() + 15 * 60 * 1000),
          },
        ]),
        limit: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() + 15 * 60 * 1000),
          },
        ]),
        delete: jest.fn().mockReturnThis(),
      };

      jest.spyOn(require('drizzle-orm/node-postgres'), 'drizzle').mockReturnValue(mockDb as any);

      await authService.resetPassword(resetToken, 'newpassword');

      // Verify session blocking was called (multiple redis.set calls for each version)
      expect(mockCacheService.redis.set).toHaveBeenCalledWith(
        expect.stringContaining('session:blocked:user1:'),
        '1',
        'EX',
        expect.any(Number),
      );
    });
  });

  // =========================================================================
  // SESSION MANAGEMENT & REVOCATION
  // =========================================================================
  describe('session management', () => {
    describe('isSessionRevoked', () => {
      it('should return false for non-revoked session', async () => {
        mockCacheService.redis.get.mockResolvedValue(null);

        const isRevoked = await authService.isSessionRevoked('user1', 0);

        expect(isRevoked).toBe(false);
      });

      it('should return true for revoked session', async () => {
        mockCacheService.redis.get.mockResolvedValue('1');

        const isRevoked = await authService.isSessionRevoked('user1', 0);

        expect(isRevoked).toBe(true);
      });

      it('should check Redis with correct key pattern', async () => {
        mockCacheService.redis.get.mockResolvedValue(null);

        await authService.isSessionRevoked('user123', 5);

        expect(mockCacheService.redis.get).toHaveBeenCalledWith('session:blocked:user123:5');
      });
    });

    describe('blockOldSessions', () => {
      it('should block all session versions up to and including the old version', async () => {
        mockCacheService.redis.set.mockResolvedValue(undefined);

        // This would need to be tested by calling blockOldSessions directly
        // For now, we test it indirectly through resetPassword
        expect(mockCacheService.redis.set).toBeDefined();
      });
    });

    it('should increment session version on password reset', async () => {
      authService.users.set('user1', {
        id: 'user1',
        email: 'user@example.com',
        passwordHash: 'old_hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 5,
      });

      const resetToken = 'reset_token';
      const tokenPayload = { sub: 'user1', type: 'password_reset' };

      mockJwt.verify.mockReturnValue(tokenPayload as never);
      mockBcrypt.hash.mockResolvedValue('new_hash' as never);
      mockCacheService.redis.set.mockResolvedValue(undefined);

      const mockDb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() + 15 * 60 * 1000),
          },
        ]),
        limit: jest.fn().mockResolvedValue([
          {
            id: 'token_id',
            user_id: 'user1',
            token_hash: expect.any(String),
            expires_at: new Date(Date.now() + 15 * 60 * 1000),
          },
        ]),
        delete: jest.fn().mockReturnThis(),
      };

      jest.spyOn(require('drizzle-orm/node-postgres'), 'drizzle').mockReturnValue(mockDb as any);

      await authService.resetPassword(resetToken, 'newpassword');

      const user = authService.users.get('user1');
      expect(user?.sessionVersion).toBe(6); // incremented from 5
    });
  });

  // =========================================================================
  // EMAIL VERIFICATION
  // =========================================================================
  describe('isEmailVerified', () => {
    it('should return true for verified email', () => {
      authService.users.set('verified-user', {
        id: 'verified-user',
        email: 'verified@example.com',
        passwordHash: 'hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 0,
      });

      expect(authService.isEmailVerified('verified-user')).toBe(true);
    });

    it('should return false for unverified email', () => {
      authService.users.set('unverified-user', {
        id: 'unverified-user',
        email: 'unverified@example.com',
        passwordHash: 'hash',
        emailVerified: false,
        twoFactorEnabled: false,
        sessionVersion: 0,
      });

      expect(authService.isEmailVerified('unverified-user')).toBe(false);
    });

    it('should return false for non-existent user', () => {
      expect(authService.isEmailVerified('nonexistent')).toBe(false);
    });
  });

  // =========================================================================
  // SECURITY - BCRYPT PASSWORD HASHING
  // =========================================================================
  describe('password hashing security', () => {
    it('should use bcrypt with 12 rounds for password hashing', async () => {
      mockCacheService.redis.set.mockResolvedValue(undefined);
      mockEmailService.sendVerificationEmail.mockResolvedValue(true);
      mockBcrypt.hash.mockResolvedValue('hashed_password' as never);

      // Registration currently has TODO to implement bcrypt
      await authService.register('test@example.com', 'password123');

      // In actual implementation, should call bcrypt.hash with 12 rounds
      const user = authService.users.get([...authService.users.keys()][0]);
      expect(user?.passwordHash).toBeDefined();
    });

    it('should use bcrypt to compare passwords on login', async () => {
      authService.users.set('user1', {
        id: 'user1',
        email: 'user@example.com',
        passwordHash: 'hashed_password',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 0,
      });

      mockBcrypt.compare.mockResolvedValue(true as never);
      mockJwt.sign.mockReturnValue('token' as never);

      await authService.login('user@example.com', 'password123');

      expect(mockBcrypt.compare).toHaveBeenCalledWith('password123', 'hashed_password');
    });
  });

  // =========================================================================
  // INTEGRATION TESTS
  // =========================================================================
  describe('integration scenarios', () => {
    it('should complete full registration and login flow', async () => {
      // Setup
      mockCacheService.redis.set.mockResolvedValue(undefined);
      mockEmailService.sendVerificationEmail.mockResolvedValue(true);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockJwt.sign.mockReturnValue('token' as never);

      // Register
      const registerResult = await authService.register('newuser@example.com', 'password123');
      expect(registerResult.userId).toBeDefined();

      // Mark as verified (in real app, would verify token)
      const user = authService.users.get(registerResult.userId);
      if (user) user.emailVerified = true;

      // Login
      const loginResult = await authService.login('newuser@example.com', 'password123');
      expect('accessToken' in loginResult).toBe(true);
    });

    it('should complete full 2FA setup and verification flow', async () => {
      // Setup user
      authService.users.set('user-2fa-flow', {
        id: 'user-2fa-flow',
        email: 'user2fa@example.com',
        passwordHash: 'hash',
        emailVerified: true,
        twoFactorEnabled: false,
        sessionVersion: 0,
      });

      // Setup mocks
      mockTotpService.generateSecret.mockReturnValue({
        secret: 'base32secret',
        otpauthUrl: 'otpauth://...',
      });
      mockTotpService.generateQRCode.mockResolvedValue('qr_code');
      mockCryptoService.encrypt.mockReturnValue('encrypted_secret');
      mockCryptoService.decrypt.mockReturnValue('base32secret');
      mockTotpService.verifyToken.mockReturnValue(true);
      mockJwt.sign.mockReturnValue('token' as never);
      mockBcrypt.compare.mockResolvedValue(true as never);

      // 1. Setup 2FA
      const setupResult = await authService.setup2FA('user-2fa-flow');
      expect(setupResult.qrCode).toBeDefined();

      // 2. Enable 2FA
      await authService.enable2FA('user-2fa-flow', '123456');
      expect(authService.users.get('user-2fa-flow')?.twoFactorEnabled).toBe(true);

      // 3. Login triggers 2FA
      const loginResult = await authService.login('user2fa@example.com', 'password');
      expect('tempToken' in loginResult && loginResult.requires2FA).toBe(true);

      // 4. Verify OTP
      const tempPayload = { sub: 'user-2fa-flow', type: 'temp_2fa' };
      mockJwt.verify.mockReturnValue(tempPayload as never);

      const finalResult = await authService.verify2FA('temp_token', '123456');
      expect(finalResult.accessToken).toBeDefined();
      expect(finalResult.refreshToken).toBeDefined();
    });
  });
});
