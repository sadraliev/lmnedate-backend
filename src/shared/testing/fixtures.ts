import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import type { User } from '../../modules/auth/auth.types.js';

export const createTestUser = async (
  overrides: Partial<User> = {}
): Promise<User> => {
  const passwordHash = await bcrypt.hash('password123', 10);

  return {
    _id: new ObjectId(),
    email: 'test@example.com',
    passwordHash,
    name: 'Test User',
    role: 'user',
    timeZone: 'America/New_York',
    emailVerified: false,
    loginAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

export const createTestAdmin = async (
  overrides: Partial<User> = {}
): Promise<User> => {
  return createTestUser({
    email: 'admin@example.com',
    name: 'Test Admin',
    role: 'admin',
    ...overrides,
  });
};
