import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';

const SALT_ROUNDS = 10;

/**
 * Hash a password
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Verify a password against a hash
 */
export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate a secure 6-digit code
 */
export const generateSixDigitCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Generate a secure token for invitation links
 */
export const generateSecureToken = (): string => {
  return nanoid(32);
};

/**
 * SHA-256 hash for high-entropy tokens (refresh/reset/verification).
 * Deterministic so we can query the DB directly. Not bcrypt because
 * these are random 32-char tokens, not user-chosen passwords.
 */
export const hashToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};

/**
 * Hash a code for storage
 */
export const hashCode = async (code: string): Promise<string> => {
  return hashPassword(code);
};

/**
 * Verify a code against a hash
 */
export const verifyCode = async (
  code: string,
  hash: string
): Promise<boolean> => {
  return verifyPassword(code, hash);
};
