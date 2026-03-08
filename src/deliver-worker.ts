/**
 * Process 2: Deliver worker.
 *
 * Consumes deliver jobs from BullMQ and sends messages to Telegram.
 * Uses Grammy Bot in "API-only" mode (no long polling).
 */

import 'dotenv/config';
import { Bot } from 'grammy';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from './shared/jobs/queue-names.js';
import type { DeliverJobData } from './shared/jobs/job-types.js';
import { createRedisConnection } from './shared/config/redis-standalone.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

if (!TELEGRAM_BOT_TOKEN) {
  console.error('[deliver] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

// Grammy in "API-only" mode — no long polling
const bot = new Bot(TELEGRAM_BOT_TOKEN);
const redisConnection = createRedisConnection(REDIS_URL, 'deliver');

// ---------------------------------------------------------------------------
// Deliver worker
// ---------------------------------------------------------------------------
const worker = new Worker<DeliverJobData>(
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

worker.on('completed', (job) => {
  console.log(`[deliver] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[deliver] Job ${job?.id} failed:`, err.message);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
console.log('[deliver] Deliver worker started');

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`[deliver] Received ${signal}, shutting down...`);
  const timeout = setTimeout(() => {
    console.error('[deliver] Shutdown timed out after 10s, forcing exit');
    process.exit(1);
  }, 10_000);
  await worker.close();
  clearTimeout(timeout);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
