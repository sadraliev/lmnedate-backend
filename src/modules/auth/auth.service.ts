import { ObjectId } from 'mongodb';
import { getDatabase } from '../../shared/database/connection.js';
import { hashPassword, verifyPassword, generateSecureToken, hashToken } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/config/logger.js';
import type { User, UserRole, Session } from './auth.types.js';

/**
 * Find user by ID
 */
export const findUserById = async (userId: string): Promise<User | null> => {
  const db = getDatabase();
  return db.collection<User>('users').findOne({ _id: new ObjectId(userId) });
};

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Register a new user with email verification token
 */
export const registerUser = async (data: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  timeZone: string;
}): Promise<{ user: User; emailVerificationToken: string }> => {
  const db = getDatabase();

  const existingUser = await db
    .collection<User>('users')
    .findOne({ email: data.email });

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const passwordHash = await hashPassword(data.password);
  const emailVerificationToken = generateSecureToken();
  const emailVerificationTokenHash = hashToken(emailVerificationToken);

  const user: Omit<User, '_id'> = {
    email: data.email,
    passwordHash,
    name: data.name,
    role: data.role,
    timeZone: data.timeZone,
    emailVerified: false,
    emailVerificationTokenHash,
    emailVerificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    loginAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection<User>('users').insertOne(user as User);

  const createdUser = { ...user, _id: result.insertedId } as User;

  logger.info(
    { email: data.email, token: emailVerificationToken },
    'Email verification link generated'
  );

  return { user: createdUser, emailVerificationToken };
};

/**
 * Authenticate a user with lockout protection
 */
export const authenticateUser = async (
  email: string,
  password: string
): Promise<User> => {
  const db = getDatabase();

  const user = await db.collection<User>('users').findOne({ email });

  if (!user) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  // Check lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw Object.assign(new Error('Account is locked. Try again later.'), { statusCode: 423 });
  }

  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    const newAttempts = (user.loginAttempts || 0) + 1;
    const updateFields: Record<string, unknown> = {
      loginAttempts: newAttempts,
      updatedAt: new Date(),
    };

    if (newAttempts >= LOCKOUT_THRESHOLD) {
      updateFields.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    }

    await db.collection<User>('users').updateOne(
      { _id: user._id },
      { $set: updateFields }
    );

    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }

  // Success: reset attempts, set lastLoginAt
  await db.collection<User>('users').updateOne(
    { _id: user._id },
    {
      $set: {
        loginAttempts: 0,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
      $unset: { lockedUntil: '' },
    }
  );

  return { ...user, loginAttempts: 0, lastLoginAt: new Date() };
};

/**
 * Create a session with a hashed refresh token
 */
export const createSession = async (
  userId: ObjectId,
  expiresAt: Date,
  deviceInfo?: string
): Promise<string> => {
  const db = getDatabase();
  const rawToken = generateSecureToken();
  const refreshTokenHash = hashToken(rawToken);

  const session: Omit<Session, '_id'> = {
    userId,
    refreshTokenHash,
    expiresAt,
    deviceInfo,
    createdAt: new Date(),
  };

  await db.collection<Session>('sessions').insertOne(session as Session);

  return rawToken;
};

/**
 * Consume a refresh token (rotation: find + delete)
 */
export const consumeRefreshToken = async (
  refreshToken: string
): Promise<{ userId: ObjectId; deviceInfo?: string } | null> => {
  const db = getDatabase();
  const tokenHash = hashToken(refreshToken);

  const session = await db.collection<Session>('sessions').findOneAndDelete({
    refreshTokenHash: tokenHash,
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    return null;
  }

  return { userId: session.userId, deviceInfo: session.deviceInfo };
};

/**
 * Revoke a refresh token
 */
export const revokeRefreshToken = async (
  refreshToken: string
): Promise<boolean> => {
  const db = getDatabase();
  const tokenHash = hashToken(refreshToken);

  const result = await db.collection<Session>('sessions').deleteOne({
    refreshTokenHash: tokenHash,
  });

  return result.deletedCount > 0;
};

/**
 * Generate a password reset token
 */
export const generatePasswordResetToken = async (
  email: string
): Promise<boolean> => {
  const db = getDatabase();

  const user = await db.collection<User>('users').findOne({ email });

  if (!user) {
    // Return true anyway to prevent email enumeration
    return true;
  }

  const token = generateSecureToken();
  const resetTokenHash = hashToken(token);

  await db.collection<User>('users').updateOne(
    { _id: user._id },
    {
      $set: {
        resetTokenHash,
        resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
        updatedAt: new Date(),
      },
    }
  );

  logger.info({ email, token }, 'Password reset link generated');

  return true;
};

/**
 * Reset password using a token
 */
export const resetPassword = async (
  token: string,
  password: string
): Promise<boolean> => {
  const db = getDatabase();
  const tokenHash = hashToken(token);

  const user = await db.collection<User>('users').findOne({
    resetTokenHash: tokenHash,
    resetTokenExpiresAt: { $gt: new Date() },
  });

  if (!user) {
    return false;
  }

  const passwordHash = await hashPassword(password);

  await db.collection<User>('users').updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash,
        updatedAt: new Date(),
      },
      $unset: {
        resetTokenHash: '',
        resetTokenExpiresAt: '',
      },
    }
  );

  return true;
};

/**
 * Confirm email using a verification token
 */
export const confirmEmail = async (token: string): Promise<boolean> => {
  const db = getDatabase();
  const tokenHash = hashToken(token);

  const user = await db.collection<User>('users').findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationTokenExpiresAt: { $gt: new Date() },
  });

  if (!user) {
    return false;
  }

  await db.collection<User>('users').updateOne(
    { _id: user._id },
    {
      $set: {
        emailVerified: true,
        updatedAt: new Date(),
      },
      $unset: {
        emailVerificationTokenHash: '',
        emailVerificationTokenExpiresAt: '',
      },
    }
  );

  return true;
};
