/**
 * Process 1: Telegram bot.
 *
 * /start  → welcome message
 * /update <username> → enqueue scrape job with chatId
 */

import { Queue } from 'bullmq';
import { QUEUE_NAMES, createRedisConnection } from '@app/shared';
import type { ScrapeJobData } from '@app/shared';
import { bot } from './bot-instance.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redisConnection = createRedisConnection(REDIS_URL, 'bot');

const scrapeQueue = new Queue<ScrapeJobData>(QUEUE_NAMES.INSTAGRAM_SCRAPE, {
  connection: redisConnection,
});

bot.command('start', async (ctx) => {
  console.log(`[bot] /start from chatId=${ctx.chat.id}`);
  await ctx.reply(
    'Instagram Scraper Bot\n\n' +
    'Send /update <username> to get the latest post from any public Instagram account.\n\n' +
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

  await scrapeQueue.add(
    `scrape-${username}-${chatId}`,
    {
      username,
      chatId,
      enqueuedAt: new Date().toISOString(),
    },
    {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 10 },
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
    },
  );

  await ctx.reply(`Fetching latest post from @${username}... This may take up to 30 seconds.`);
});

bot.catch((err) => {
  console.error('[bot] Grammy error:', err.error);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const main = async () => {
  bot.start();
  console.log('[bot] Telegram bot started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[bot] Received ${signal}, shutting down...`);
    await bot.stop();
    await scrapeQueue.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

main().catch((err) => {
  console.error('[bot] Fatal error:', err);
  process.exit(1);
});
