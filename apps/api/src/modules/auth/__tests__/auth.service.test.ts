import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDatabase } from '../../../testing/setup.js';
import {
  registerUser,
  authenticateUser,
  createSession,
  consumeRefreshToken,
  revokeRefreshToken,
  generatePasswordResetToken,
  resetPassword,
  confirmEmail,
} from '../auth.service.js';
import { hashToken } from '../../../utils/crypto.js';
import * as connection from '../../../database/connection.js';
import type { User } from '../auth.types.js';

describe('Auth Service', () => {
  const getDb = setupTestDatabase();

  beforeEach(() => {
    vi.spyOn(connection, 'getDatabase').mockReturnValue(getDb());
  });

  describe('Registration', () => {
    const validData = {
      email: 'new@example.com',
      password: 'password123',
      name: 'New User',
      role: 'user' as const,
      timeZone: 'America/New_York',
    };

    it('should register with emailVerified=false', async () => {
      const { user } = await registerUser(validData);
      expect(user.emailVerified).toBe(false);
    });

    it('should generate a verification token', async () => {
      const { emailVerificationToken } = await registerUser(validData);
      expect(emailVerificationToken).toBeDefined();
      expect(emailVerificationToken.length).toBeGreaterThan(0);
    });

    it('should store hashed verification token in DB', async () => {
      const { user, emailVerificationToken } = await registerUser(validData);
      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ _id: user._id });
      expect(dbUser?.emailVerificationTokenHash).toBe(hashToken(emailVerificationToken));
    });

    it('should reject duplicate email', async () => {
      await registerUser(validData);
      await expect(registerUser(validData)).rejects.toThrow(
        'User with this email already exists'
      );
    });

    it('should hash the password', async () => {
      const { user } = await registerUser(validData);
      expect(user.passwordHash).not.toBe(validData.password);
      expect(user.passwordHash).toMatch(/^\$2[ab]\$/);
    });

    it('should set loginAttempts to 0', async () => {
      const { user } = await registerUser(validData);
      expect(user.loginAttempts).toBe(0);
    });
  });

  describe('Authentication', () => {
    const userData = {
      email: 'auth@example.com',
      password: 'password123',
      name: 'Auth User',
      role: 'user' as const,
      timeZone: 'UTC',
    };

    it('should authenticate with valid credentials and update lastLoginAt', async () => {
      await registerUser(userData);
      const user = await authenticateUser(userData.email, userData.password);
      expect(user.email).toBe(userData.email);
      expect(user.lastLoginAt).toBeDefined();
    });

    it('should throw 401 on invalid password', async () => {
      await registerUser(userData);
      await expect(
        authenticateUser(userData.email, 'wrongpassword')
      ).rejects.toThrow('Invalid email or password');
    });

    it('should increment loginAttempts on failure', async () => {
      await registerUser(userData);

      try {
        await authenticateUser(userData.email, 'wrong');
      } catch { /* expected */ }

      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ email: userData.email });
      expect(dbUser?.loginAttempts).toBe(1);
    });

    it('should lock account after 5 failed attempts', async () => {
      await registerUser(userData);

      for (let i = 0; i < 5; i++) {
        try {
          await authenticateUser(userData.email, 'wrong');
        } catch { /* expected */ }
      }

      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ email: userData.email });
      expect(dbUser?.lockedUntil).toBeDefined();
      expect(dbUser!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should throw 423 when account is locked', async () => {
      await registerUser(userData);

      // Lock the account manually
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: userData.email },
          { $set: { lockedUntil: new Date(Date.now() + 60000), loginAttempts: 5 } }
        );

      try {
        await authenticateUser(userData.email, userData.password);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toBe('Account is locked. Try again later.');
        expect((error as Error & { statusCode: number }).statusCode).toBe(423);
      }
    });

    it('should allow login after lockout expires', async () => {
      await registerUser(userData);

      // Set lockedUntil in the past
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: userData.email },
          { $set: { lockedUntil: new Date(Date.now() - 1000), loginAttempts: 5 } }
        );

      const user = await authenticateUser(userData.email, userData.password);
      expect(user.email).toBe(userData.email);
    });

    it('should reset loginAttempts on successful login', async () => {
      await registerUser(userData);

      // Set some failed attempts
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: userData.email },
          { $set: { loginAttempts: 3 } }
        );

      await authenticateUser(userData.email, userData.password);

      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ email: userData.email });
      expect(dbUser?.loginAttempts).toBe(0);
    });
  });

  describe('Sessions', () => {
    it('should create a session and return a token', async () => {
      const userId = new ObjectId();
      const expiresAt = new Date(Date.now() + 86400000);
      const token = await createSession(userId, expiresAt);

      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should consume a valid session and return userId', async () => {
      const userId = new ObjectId();
      const expiresAt = new Date(Date.now() + 86400000);
      const token = await createSession(userId, expiresAt);

      const result = await consumeRefreshToken(token);
      expect(result).not.toBeNull();
      expect(result!.userId.toString()).toBe(userId.toString());
    });

    it('should delete session on consume (rotation)', async () => {
      const userId = new ObjectId();
      const expiresAt = new Date(Date.now() + 86400000);
      const token = await createSession(userId, expiresAt);

      await consumeRefreshToken(token);

      // Second consume should fail
      const result = await consumeRefreshToken(token);
      expect(result).toBeNull();
    });

    it('should return null for invalid token', async () => {
      const result = await consumeRefreshToken('nonexistent-token');
      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      const userId = new ObjectId();
      const expiresAt = new Date(Date.now() - 1000); // Already expired
      const token = await createSession(userId, expiresAt);

      const result = await consumeRefreshToken(token);
      expect(result).toBeNull();
    });
  });

  describe('Revoke', () => {
    it('should revoke (delete) a session', async () => {
      const userId = new ObjectId();
      const expiresAt = new Date(Date.now() + 86400000);
      const token = await createSession(userId, expiresAt);

      const revoked = await revokeRefreshToken(token);
      expect(revoked).toBe(true);

      // Token should no longer be consumable
      const result = await consumeRefreshToken(token);
      expect(result).toBeNull();
    });

    it('should return false for non-existent token', async () => {
      const revoked = await revokeRefreshToken('nonexistent-token');
      expect(revoked).toBe(false);
    });
  });

  describe('Password Reset', () => {
    const userData = {
      email: 'reset@example.com',
      password: 'password123',
      name: 'Reset User',
      role: 'user' as const,
      timeZone: 'UTC',
    };

    it('should generate a reset token for existing user', async () => {
      await registerUser(userData);
      const result = await generatePasswordResetToken(userData.email);
      expect(result).toBe(true);

      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ email: userData.email });
      expect(dbUser?.resetTokenHash).toBeDefined();
      expect(dbUser?.resetTokenExpiresAt).toBeDefined();
    });

    it('should return true even for non-existent email (prevent enumeration)', async () => {
      const result = await generatePasswordResetToken('nonexistent@example.com');
      expect(result).toBe(true);
    });

    it('should reset password with valid token', async () => {
      await registerUser(userData);

      // Get the reset token from the DB (we need to generate one first)
      await generatePasswordResetToken(userData.email);

      // Get the stored hash to find the raw token we logged
      // Instead, we'll manually set a known token
      const rawToken = 'test-reset-token-12345678901';
      const tokenHash = hashToken(rawToken);
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: userData.email },
          {
            $set: {
              resetTokenHash: tokenHash,
              resetTokenExpiresAt: new Date(Date.now() + 3600000),
            },
          }
        );

      const success = await resetPassword(rawToken, 'newpassword123');
      expect(success).toBe(true);

      // Should be able to login with new password
      const user = await authenticateUser(userData.email, 'newpassword123');
      expect(user.email).toBe(userData.email);
    });

    it('should reject invalid reset token', async () => {
      const success = await resetPassword('invalid-token', 'newpassword123');
      expect(success).toBe(false);
    });

    it('should reject expired reset token', async () => {
      await registerUser(userData);

      const rawToken = 'expired-reset-token-123456789';
      const tokenHash = hashToken(rawToken);
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: userData.email },
          {
            $set: {
              resetTokenHash: tokenHash,
              resetTokenExpiresAt: new Date(Date.now() - 1000), // Already expired
            },
          }
        );

      const success = await resetPassword(rawToken, 'newpassword123');
      expect(success).toBe(false);
    });

    it('should clear reset fields after successful reset', async () => {
      await registerUser(userData);

      const rawToken = 'clear-fields-token-12345678901';
      const tokenHash = hashToken(rawToken);
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: userData.email },
          {
            $set: {
              resetTokenHash: tokenHash,
              resetTokenExpiresAt: new Date(Date.now() + 3600000),
            },
          }
        );

      await resetPassword(rawToken, 'newpassword123');

      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ email: userData.email });
      expect(dbUser?.resetTokenHash).toBeUndefined();
      expect(dbUser?.resetTokenExpiresAt).toBeUndefined();
    });
  });

  describe('Email Confirmation', () => {
    it('should confirm email with valid token', async () => {
      const { user, emailVerificationToken } = await registerUser({
        email: 'confirm@example.com',
        password: 'password123',
        name: 'Confirm User',
        role: 'user',
        timeZone: 'UTC',
      });

      const success = await confirmEmail(emailVerificationToken);
      expect(success).toBe(true);

      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ _id: user._id });
      expect(dbUser?.emailVerified).toBe(true);
    });

    it('should reject invalid verification token', async () => {
      const success = await confirmEmail('invalid-token');
      expect(success).toBe(false);
    });

    it('should reject expired verification token', async () => {
      const { user } = await registerUser({
        email: 'expired-confirm@example.com',
        password: 'password123',
        name: 'Expired User',
        role: 'user',
        timeZone: 'UTC',
      });

      // Set token to expired
      const rawToken = 'expired-verify-token-123456789';
      const tokenHash = hashToken(rawToken);
      await getDb()
        .collection<User>('users')
        .updateOne(
          { _id: user._id },
          {
            $set: {
              emailVerificationTokenHash: tokenHash,
              emailVerificationTokenExpiresAt: new Date(Date.now() - 1000),
            },
          }
        );

      const success = await confirmEmail(rawToken);
      expect(success).toBe(false);
    });

    it('should clear verification fields after confirmation', async () => {
      const { user, emailVerificationToken } = await registerUser({
        email: 'clear-verify@example.com',
        password: 'password123',
        name: 'Clear User',
        role: 'user',
        timeZone: 'UTC',
      });

      await confirmEmail(emailVerificationToken);

      const dbUser = await getDb()
        .collection<User>('users')
        .findOne({ _id: user._id });
      expect(dbUser?.emailVerificationTokenHash).toBeUndefined();
      expect(dbUser?.emailVerificationTokenExpiresAt).toBeUndefined();
    });
  });
});
