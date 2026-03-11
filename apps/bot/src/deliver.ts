/**
 * Process 2: Deliver worker.
 *
 * Consumes deliver jobs from BullMQ and sends messages to Telegram.
 * Uses Grammy Bot in "API-only" mode (no long polling).
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, createRedisConnection, createLogger } from '@app/shared';
import type { DeliverJobData } from '@app/shared';
import { bot } from './bot-instance.js';

const logger = createLogger({ name: 'deliver' });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redisConnection = createRedisConnection(REDIS_URL, 'deliver', logger);

// ---------------------------------------------------------------------------
// Deliver worker
// ---------------------------------------------------------------------------
const worker = new Worker<DeliverJobData>(
  QUEUE_NAMES.INSTAGRAM_DELIVER,
  async (job: Job<DeliverJobData>) => {
    const { chatId, post, error } = job.data;
    const jobLog = logger.child({ jobId: job.id, chatId });

    // Handle error/notification messages
    if (error) {
      jobLog.info({ error }, 'Sending error message');
      await bot.api.sendMessage(chatId, error);
      return;
    }

    if (!post) {
      jobLog.warn('No post data, skipping');
      return;
    }

    jobLog.info({ username: post.instagramUsername }, 'Delivering post');

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
      jobLog.error({ err }, 'Failed to deliver');
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
  logger.info({ jobId: job.id }, 'Job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Job failed');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
logger.info('Deliver worker started');

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  const timeout = setTimeout(() => {
    logger.error('Shutdown timed out after 10s, forcing exit');
    process.exit(1);
  }, 10_000);
  await worker.close();
  clearTimeout(timeout);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
