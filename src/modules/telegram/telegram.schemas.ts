import { z } from 'zod';

export const instagramUsernameSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(
    /^@?[a-zA-Z0-9._]+$/,
    'Instagram username can only contain letters, numbers, periods, and underscores'
  )
  .transform((val) => val.replace(/^@/, '').toLowerCase());
