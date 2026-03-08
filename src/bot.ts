/**
 * Process 1: Telegram bot + deliver worker.
 *
 * /start  → welcome message
 * /update <username> → enqueue scrape job with chatId
 *
 * Deliver worker receives { chatId, post } and sends to Telegram.
 */

import 'dotenv/config';
import { Bot } from 'grammy';
import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from './shared/jobs/queue-names.js';
import type { ScrapeJobData, DeliverJobData } from './shared/jobs/job-types.js';
import { createRedisConnection } from './shared/config/redis-standalone.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

if (!TELEGRAM_BOT_TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const redisConnection = createRedisConnection(REDIS_URL, 'bot');

// ---------------------------------------------------------------------------
// Grammy bot
// ---------------------------------------------------------------------------
const bot = new Bot(TELEGRAM_BOT_TOKEN);

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
// Deliver worker
// ---------------------------------------------------------------------------
const deliverWorker = new Worker<DeliverJobData>(
  QUEUE_NAMES.INSTAGRAM_DELIVER,
  async (job: Job<DeliverJobData>) => {
    const { chatId, post, error } = job.data;

    // Handle error/notification messages
    if (error) {
      console.log(`[deliver] Sending error to chatId=${chatId}: ${error}`);
      await bot.api.sendMessage(chatId, error);
      return;
    }

    if (!post) {
      console.log(`[deliver] No post data for chatId=${chatId}, skipping`);
      return;
    }

    console.log(`[deliver] Delivering post from @${post.instagramUsername} to chatId=${chatId}`);

    const caption =
      `<b>@${post.instagramUsername}</b>\n\n` +
      (post.caption ? `${post.caption.substring(0, 800)}\n\n` : '') +
      `<a href="${post.permalink}">View on Instagram</a>`;

    const send = async () => {
      // NOTE: link_preview_options with Instagram URLs triggers aggressive Telegram
      // rate limiting (429). Sending plain HTML text works reliably.
      if (post.mediaType === 'video') {
        await bot.api.sendMessage(chatId, caption, { parse_mode: 'HTML' });
      } else {
        try {
          await bot.api.sendPhoto(chatId, post.mediaUrl, {
            caption,
            parse_mode: 'HTML',
          });
        } catch {
          // Fallback to text message if photo sending fails (e.g., URL expired)
          await bot.api.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        }
      }
    };

    try {
      await send();
    } catch (err: unknown) {
      console.error(`[deliver] Failed to deliver to chatId=${chatId}:`, err);
      throw err; // Let BullMQ handle retries with backoff
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: {
      max: 1,
      duration: 3_000,
    },
  },
);

deliverWorker.on('completed', (job) => {
  console.log(`[deliver] Job ${job.id} completed`);
});

deliverWorker.on('failed', (job, err) => {
  console.error(`[deliver] Job ${job?.id} failed:`, err.message);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const main = async () => {
  bot.start();
  console.log('[bot] Telegram bot started');
  console.log('[deliver] Deliver worker started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[bot] Received ${signal}, shutting down...`);
    await bot.stop();
    await deliverWorker.close();
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
