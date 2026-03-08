import { z } from 'zod';
import { isValidTimeZone } from './time.js';

/**
 * Email validation schema
 */
export const emailSchema = z.string().email();

/**
 * Password validation schema
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password is too long');

/**
 * Time zone validation schema
 */
export const timeZoneSchema = z.string().refine(isValidTimeZone, {
  message: 'Invalid time zone',
});

/**
 * ObjectId string validation
 */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  message: 'Invalid ObjectId format',
});

/**
 * ISO date string validation
 */
export const isoDateSchema = z.string().datetime();
