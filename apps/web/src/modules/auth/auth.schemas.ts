import { z } from 'zod';
import { emailSchema, passwordSchema, timeZoneSchema } from '../../utils/validation.js';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'user']),
  timeZone: timeZoneSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const confirmEmailSchema = z.object({
  token: z.string().min(1),
});
