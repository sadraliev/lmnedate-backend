/**
 * Process 1: Telegram bot.
 *
 * /start  → welcome message
 * /update <username> → subscribe to an Instagram account
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

import { Bot } from 'grammy';
import {
  createLogger,
  connectToDatabase,
  closeDatabaseConnection,
  getDatabase,
  ensureSubscriptionIndexes,
  ensureAccountIndexes,
  addSubscription,
  findOrCreateAccount,
} from '@app/shared';

const logger = createLogger({ name: 'bot' });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  logger.fatal('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27019/instagram-scraper';

const bot = new Bot(TELEGRAM_BOT_TOKEN);

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

bot.command('stats', async (ctx) => {
  try {
    const db = getDatabase();
    const [totalUsers, totalSubscriptions, totalPosts] = await Promise.all([
      db.collection('telegram_users').aggregate([
        { $group: { _id: '$chatId' } },
        { $count: 'count' },
      ]).toArray().then((r) => r[0]?.count ?? 0),
      db.collection('telegram_users').countDocuments(),
      db.collection('instagram_posts').countDocuments(),
    ]);

    await ctx.reply(
      `Stats\n\n` +
      `Users: ${totalUsers}\n` +
      `Subscriptions: ${totalSubscriptions}\n` +
      `Posts: ${totalPosts}`,
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to get stats');
    await ctx.reply('Failed to get stats. Please try again later.');
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
