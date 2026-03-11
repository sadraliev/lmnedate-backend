import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32),
  MONGODB_URI: z.string().url(),
  MONGODB_URI_TEST: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  INSTAGRAM_POLL_INTERVAL_MS: z.string().default('900000'),
});

export type Env = z.infer<typeof envSchema>;

export const parseEnv = (): Env => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Invalid environment variables');
  }

  return result.data;
};

export const env = parseEnv();
