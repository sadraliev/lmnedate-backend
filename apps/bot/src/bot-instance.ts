import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot } from 'grammy';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

export const bot = new Bot(TELEGRAM_BOT_TOKEN);
