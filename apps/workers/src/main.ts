/**
 * Workers process: deliver + scheduler.
 *
 * Single process, two BullMQ workers:
 * 1. Deliver — consumes INSTAGRAM_DELIVER, sends messages via Grammy (API-only).
 * 2. Scheduler — upsertJobScheduler (15 min) + poll worker that enqueues scrape jobs.
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { Bot } from 'grammy';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createLogger,
  connectToDatabase,
  closeDatabaseConnection,
  ensureSubscriptionIndexes,
  ensureAccountIndexes,
  getDistinctActiveAccounts,
  findAccountByUsername,
} from '@app/shared';
import type { ScrapeJobData, DeliverJobData, CarouselMediaItem } from '@app/shared';
import type { InputMediaPhoto, InputMediaVideo } from 'grammy/types';

const logger = createLogger({ name: 'workers' });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  logger.fatal('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27019/instagram-scraper';
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Grammy Bot — API-only, no long polling (used only for sendMessage etc.)
const bot = new Bot(TELEGRAM_BOT_TOKEN);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  // 1. MongoDB
  await connectToDatabase(MONGODB_URI);
  await ensureSubscriptionIndexes();
  await ensureAccountIndexes();
  logger.info('Connected to MongoDB');

  // 2. Shared Redis connection
  const connection = createRedisConnection(REDIS_URL, 'workers', logger);

  // -------------------------------------------------------------------------
  // Deliver worker
  // -------------------------------------------------------------------------
  const deliverWorker = new Worker<DeliverJobData>(
    QUEUE_NAMES.INSTAGRAM_DELIVER,
    async (job: Job<DeliverJobData>) => {
      const { chatId, scrapedInMs, post, error } = job.data;
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
      if (scrapedInMs != null) {
        const secs = Math.round(scrapedInMs / 1000);
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
      connection,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 3_000,
      },
    },
  );

  deliverWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Deliver job completed');
  });

  deliverWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Deliver job failed');
  });

  logger.info('Deliver worker started');

  // -------------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------------
  const pollQueue = new Queue(QUEUE_NAMES.INSTAGRAM_POLL, { connection });
  const scrapeQueue = new Queue<ScrapeJobData>(QUEUE_NAMES.INSTAGRAM_SCRAPE, { connection });

  // Clean stale schedulers, then register fresh one
  const existingSchedulers = await pollQueue.getJobSchedulers();
  for (const s of existingSchedulers) {
    if (s.id && s.id !== 'instagram-poll-scheduler') {
      await pollQueue.removeJobScheduler(s.id);
    }
  }
  await pollQueue.upsertJobScheduler(
    'instagram-poll-scheduler',
    { every: POLL_INTERVAL_MS },
    { name: 'poll-tick' },
  );
  // Drain leftover delayed/waiting jobs from previous runs
  await pollQueue.drain();
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Repeatable poll job registered');

  const pollWorker = new Worker(
    QUEUE_NAMES.INSTAGRAM_POLL,
    async (_job: Job) => {
      const activeUsernames = await getDistinctActiveAccounts();

      if (activeUsernames.length === 0) {
        logger.info('No subscriptions, skipping poll');
        return;
      }

      let enqueued = 0;

      for (const username of activeUsernames) {
        const account = await findAccountByUsername(username);
        if (!account || account.status !== 'scrapeable') {
          logger.debug({ username, status: account?.status }, 'Skipping non-scrapeable account');
          continue;
        }

        await scrapeQueue.add(
          `scrape-${username}`,
          {
            username,
          } satisfies ScrapeJobData,
          {
            jobId: `scrape-${username}`,
            removeOnComplete: true,
            removeOnFail: { count: 100 },
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        );
        enqueued++;
      }

      logger.info({ enqueued, accounts: activeUsernames.length }, 'Enqueued scrape jobs');
    },
    { connection },
  );

  pollWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Poll tick completed');
  });

  pollWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Poll tick failed');
  });

  logger.info('Scheduler started');

  // -------------------------------------------------------------------------
  // Graceful shutdown (15s timeout)
  // -------------------------------------------------------------------------
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    const timeout = setTimeout(() => {
      logger.error('Shutdown timed out after 15s, forcing exit');
      process.exit(1);
    }, 15_000);

    await deliverWorker.close();
    await pollWorker.close();
    await scrapeQueue.close();
    await pollQueue.close();
    await closeDatabaseConnection();

    clearTimeout(timeout);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
