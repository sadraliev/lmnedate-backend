/**
 * Docker entry point for the Instagram scraper worker.
 *
 * PoC: no MongoDB, sessions in Redis, scrape → deliver queue with post data.
 */

import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, createRedisConnection, createLogger } from '@app/shared';
import type { ScrapeJobData, DeliverJobData } from '@app/shared';
import { scrapeProfile, initSession, closeBrowser, withTimeout } from './scrape.js';

const logger = createLogger({ name: 'scraper' });

// ---------------------------------------------------------------------------
// Config from environment (no env.ts dependency)
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const SCRAPE_CONCURRENCY = parseInt(process.env.SCRAPE_CONCURRENCY ?? '1', 10);
const SCRAPE_TIMEOUT_MS = parseInt(process.env.SCRAPE_TIMEOUT_MS ?? '30000', 10);
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME ?? '';
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD ?? '';

// ---------------------------------------------------------------------------
// Redis connection for session storage (with retry + event handlers)
// ---------------------------------------------------------------------------
let redis: Redis;

const connectRedis = (): Redis => {
  redis = new Redis(REDIS_URL, {
    retryStrategy: (times) => {
      const delay = Math.min(times * 500, 30_000);
      logger.info({ attempt: times, delay }, 'Redis reconnecting');
      return delay;
    },
    maxRetriesPerRequest: 3,
  });
  redis.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  redis.on('reconnecting', () => logger.info('Redis reconnecting...'));
  logger.info('Connected to Redis');
  return redis;
};

// ---------------------------------------------------------------------------
// BullMQ Worker
// ---------------------------------------------------------------------------
const main = async () => {
  connectRedis();
  await initSession(redis, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD);

  const bullmqConnection = createRedisConnection(REDIS_URL, 'scraper-bullmq', logger);

  const deliverQueue = new Queue<DeliverJobData>(QUEUE_NAMES.INSTAGRAM_DELIVER, {
    connection: bullmqConnection,
  });

  const worker = new Worker<ScrapeJobData>(
    QUEUE_NAMES.INSTAGRAM_SCRAPE,
    async (job: Job<ScrapeJobData>) => {
      const { username, chatId } = job.data;
      const jobLog = logger.child({ jobId: job.id, username, chatId });
      jobLog.info('Processing scrape job');

      try {
        const rawPosts = await withTimeout(
          scrapeProfile(username, SCRAPE_TIMEOUT_MS, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD, redis),
          SCRAPE_TIMEOUT_MS + 10_000,
          `scrape @${username}`,
        );

        if (rawPosts.length === 0) {
          jobLog.info('No posts found');
          await deliverQueue.add(
            `deliver-${username}-${Date.now()}`,
            { chatId, error: `No posts found for @${username}. The profile may be private or empty.` },
            { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
          );
          return;
        }

        // Take the first (latest) post and enqueue delivery
        const latestPost = rawPosts[0];
        await deliverQueue.add(
          `deliver-${username}-${Date.now()}`,
          {
            chatId,
            post: {
              instagramUsername: latestPost.instagramUsername,
              caption: latestPost.caption,
              mediaUrl: latestPost.mediaUrl,
              mediaType: latestPost.mediaType,
              permalink: latestPost.permalink,
            },
          },
          {
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        );
        jobLog.info('Enqueued delivery');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jobLog.error({ err: message }, 'Failed to scrape');
        await deliverQueue.add(
          `deliver-error-${username}-${Date.now()}`,
          { chatId, error: `Failed to fetch @${username}: ${message}` },
          { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
        );
        throw error;
      }
    },
    {
      connection: bullmqConnection,
      concurrency: SCRAPE_CONCURRENCY,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Job failed');
  });

  logger.info({ concurrency: SCRAPE_CONCURRENCY, timeout: SCRAPE_TIMEOUT_MS }, 'Worker started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await worker.close();
    await deliverQueue.close();
    await closeBrowser();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
