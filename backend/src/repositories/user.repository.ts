/**
 * User Repository
 *
 * Data access layer for user profile operations.
 * Provides methods for querying and updating user account information.
 */

import { users } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';
import { UserTier } from '../types/auth.types.js';

// Extended user metadata not stored on UserRecord
const userMeta = new Map<string, {
  tier: UserTier;
  isActive: boolean;
  username?: string;
  avatarUrl?: string;
  createdAt: Date;
}>();

function getMeta(userId: string) {
  if (!userMeta.has(userId)) {
    userMeta.set(userId, {
      tier: UserTier.BEGINNER,
      isActive: true,
      createdAt: new Date(),
    });
  }
  return userMeta.get(userId)!;
}

export interface UserRecord {
  id: string;
  email: string;
  tier: UserTier;
  isActive: boolean;
  username?: string;
  avatarUrl?: string;
  emailVerified: boolean;
  createdAt: Date;
}

export class UserRepository {
  /**
   * Find user by ID
   */
  async findById(userId: string): Promise<UserRecord | null> {
    const user = users.get(userId);
    if (!user) return null;

    const meta = getMeta(userId);
    return {
      id: user.id,
      email: user.email,
      tier: meta.tier,
      isActive: meta.isActive,
      username: meta.username,
      avatarUrl: meta.avatarUrl,
      emailVerified: user.emailVerified,
      createdAt: meta.createdAt,
    };
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const user = [...users.values()].find((u) => u.email === email);
    if (!user) return null;

    const meta = getMeta(user.id);
    return {
      id: user.id,
      email: user.email,
      tier: meta.tier,
      isActive: meta.isActive,
      username: meta.username,
      avatarUrl: meta.avatarUrl,
      emailVerified: user.emailVerified,
      createdAt: meta.createdAt,
    };
  }

  /**
   * Update user profile (username, avatar)
   */
  async updateProfile(
    userId: string,
    updates: { username?: string; avatarUrl?: string }
  ): Promise<UserRecord> {
    const user = users.get(userId);
    if (!user) throw new AppError(404, 'User not found');

    if (updates.username) {
      // Check for duplicate username
      const taken = [...userMeta.entries()].some(
        ([id, m]) => id !== userId && m.username === updates.username
      );
      if (taken) throw new AppError(409, 'Username already taken');
      getMeta(userId).username = updates.username;
    }

    if (updates.avatarUrl !== undefined) {
      getMeta(userId).avatarUrl = updates.avatarUrl;
    }

    return this.findById(userId) as Promise<UserRecord>;
  }

  /**
   * List users with filters
   */
  async listUsers(opts: {
    page: number;
    limit: number;
    role?: UserTier;
    status?: 'active' | 'suspended';
    search?: string;
  }): Promise<{ users: UserRecord[]; total: number; page: number; limit: number }> {
    let entries = [...users.entries()];

    if (opts.role) {
      entries = entries.filter(([id]) => getMeta(id).tier === opts.role);
    }

    if (opts.status) {
      const active = opts.status === 'active';
      entries = entries.filter(([id]) => getMeta(id).isActive === active);
    }

    if (opts.search) {
      const q = opts.search.toLowerCase();
      entries = entries.filter(([, u]) => u.email.toLowerCase().includes(q));
    }

    const total = entries.length;
    const page = opts.page;
    const limit = opts.limit;
    const slice = entries.slice((page - 1) * limit, page * limit);

    const results = await Promise.all(
      slice.map(([id]) => this.findById(id) as Promise<UserRecord>)
    );

    return { users: results, total, page, limit };
  }

  /**
   * Suspend user (mark as inactive)
   */
  async suspendUser(userId: string): Promise<void> {
    const user = users.get(userId);
    if (!user) throw new AppError(404, 'User not found');

    getMeta(userId).isActive = false;
  }

  /**
   * Update user tier/role
   */
  async updateRole(userId: string, role: UserTier): Promise<UserRecord> {
    const user = users.get(userId);
    if (!user) throw new AppError(404, 'User not found');

    getMeta(userId).tier = role;
    return this.findById(userId) as Promise<UserRecord>;
  }
}
