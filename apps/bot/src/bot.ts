/**
 * Process 1: Telegram bot.
 *
 * /start  → welcome message
 * /update <username> → subscribe to an Instagram account
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import {
  createLogger,
  connectToDatabase,
  closeDatabaseConnection,
  ensureSubscriptionIndexes,
  ensureAccountIndexes,
  addSubscription,
  findOrCreateAccount,
} from '@app/shared';
import { bot } from './bot-instance.js';

const logger = createLogger({ name: 'bot' });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27019/instagram-scraper';

bot.command('start', async (ctx) => {
  logger.info({ chatId: ctx.chat.id }, '/start command received');
  await ctx.reply(
    'Instagram Scraper Bot\n\n' +
    'Send /update <username> to follow a public Instagram account.\n' +
    'New posts will be delivered automatically.\n\n' +
    'Example: /update bbcnews',
  );
});

bot.command('update', async (ctx) => {
  const username = ctx.match?.trim().replace(/^@/, '');

  if (!username) {
    await ctx.reply('Please provide an Instagram username.\nExample: /update bbcnews');
    return;
  }

  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
    await ctx.reply('Invalid username. Use only letters, numbers, periods, and underscores.');
    return;
  }

  const chatId = ctx.chat.id;

  try {
    // Create subscriber (telegram_users doc)
    await addSubscription(
      chatId,
      username,
      ctx.from?.username,
      ctx.from?.first_name,
    );

    // Ensure the Instagram account exists for the scheduler
    await findOrCreateAccount(username, chatId);

    await ctx.reply(
      `Subscribed to @${username}. New posts will be delivered automatically.`,
    );
    logger.info({ chatId, username }, 'Subscription added');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: message, chatId, username }, 'Failed to add subscription');
    await ctx.reply(`Failed to subscribe to @${username}. Please try again later.`);
  }
});

bot.catch((err) => {
  logger.error({ err: err.error }, 'Grammy error');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const main = async () => {
  // Connect to MongoDB
  await connectToDatabase(MONGODB_URI);
  await ensureSubscriptionIndexes();
  await ensureAccountIndexes();
  logger.info('Connected to MongoDB');

  const me = await bot.api.getMe();
  bot.start();
  logger.info({ botName: `@${me.username}` }, 'Telegram bot started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await bot.stop();
    await closeDatabaseConnection();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
