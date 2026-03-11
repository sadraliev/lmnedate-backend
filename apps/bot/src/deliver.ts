/**
 * Process 2: Deliver worker.
 *
 * Consumes deliver jobs from BullMQ and sends messages to Telegram.
 * Uses Grammy Bot in "API-only" mode (no long polling).
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, createRedisConnection, createLogger } from '@app/shared';
import type { DeliverJobData, CarouselMediaItem } from '@app/shared';
import type { InputMediaPhoto, InputMediaVideo } from 'grammy/types';
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
    const { chatId, enqueuedAt, post, error } = job.data;
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

    let processingTime = '';
    if (enqueuedAt) {
      const ms = Date.now() - new Date(enqueuedAt).getTime();
      const secs = Math.round(ms / 1000);
      processingTime = secs >= 60
        ? `\n\n⏱ ${Math.floor(secs / 60)}m ${secs % 60}s`
        : `\n\n⏱ ${secs}s`;
    }

    const caption =
      `<b>@${post.instagramUsername}</b>\n\n` +
      (post.caption ? `${post.caption.substring(0, 800)}\n\n` : '') +
      `<a href="${post.permalink}">View on Instagram</a>` +
      processingTime;

    const sendText = () => bot.api.sendMessage(chatId, caption, { parse_mode: 'HTML' });

    const send = async () => {
      // NOTE: link_preview_options with Instagram URLs triggers aggressive Telegram
      // rate limiting (429). Sending plain HTML text works reliably.
      if (post.mediaType === 'carousel' && post.carouselMedia?.length) {
        try {
          const media = post.carouselMedia.map((item: CarouselMediaItem, i: number) => {
            const base = i === 0 ? { caption, parse_mode: 'HTML' as const } : {};
            if (item.mediaType === 'video' && item.videoUrl) {
              return { type: 'video' as const, media: item.videoUrl, ...base } satisfies InputMediaVideo;
            }
            return { type: 'photo' as const, media: item.mediaUrl, ...base } satisfies InputMediaPhoto;
          });
          await bot.api.sendMediaGroup(chatId, media);
        } catch (err) {
          jobLog.warn({ err }, 'sendMediaGroup failed, falling back to single photo');
          try {
            await bot.api.sendPhoto(chatId, post.mediaUrl, { caption, parse_mode: 'HTML' });
          } catch {
            await sendText();
          }
        }
      } else if (post.mediaType === 'video') {
        if (post.videoUrl) {
          try {
            await bot.api.sendVideo(chatId, post.videoUrl, { caption, parse_mode: 'HTML' });
          } catch (err) {
            jobLog.warn({ err }, 'sendVideo failed, falling back to text');
            await sendText();
          }
        } else {
          await sendText();
        }
      } else {
        try {
          await bot.api.sendPhoto(chatId, post.mediaUrl, { caption, parse_mode: 'HTML' });
        } catch {
          await sendText();
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
