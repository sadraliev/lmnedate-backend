import 'dotenv/config';
import { Bot } from 'grammy';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

export const bot = new Bot(TELEGRAM_BOT_TOKEN);
