/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'text', primaryKey: true },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    email_verified: { type: 'boolean', notNull: true, default: false },
    two_factor_enabled: { type: 'boolean', notNull: true, default: false },
    two_factor_secret: { type: 'text' },
    role: { type: 'text', notNull: true, default: 'user' },
    session_version: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('users', 'email', { unique: true });
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
