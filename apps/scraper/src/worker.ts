/**
 * Docker entry point for the Instagram scraper worker.
 *
 * All jobs are scheduled: scrape → store posts → deliver only NEW posts
 * to all subscribers → update account lastPostId.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createLogger,
  connectToDatabase,
  closeDatabaseConnection,
  ensurePostIndexes,
  storeNewPosts,
  getNewPostsSince,
  getSubscribersByAccount,
  findAccountByUsername,
  updateLastScraped,
  updateAccountLastPostId,
} from '@app/shared';
import type { ScrapeJobData, DeliverJobData } from '@app/shared';
import { scrapeProfile, initSession, closeBrowser, withTimeout } from './scrape.js';

const logger = createLogger({ name: 'scraper' });

// ---------------------------------------------------------------------------
// Config from environment (no env.ts dependency)
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27019/instagram-scraper';
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

  // Connect to MongoDB for post dedup
  await connectToDatabase(MONGODB_URI);
  await ensurePostIndexes();
  logger.info('Connected to MongoDB');

  const bullmqConnection = createRedisConnection(REDIS_URL, 'scraper-bullmq', logger);

  const deliverQueue = new Queue<DeliverJobData>(QUEUE_NAMES.INSTAGRAM_DELIVER, {
    connection: bullmqConnection,
  });

  const worker = new Worker<ScrapeJobData>(
    QUEUE_NAMES.INSTAGRAM_SCRAPE,
    async (job: Job<ScrapeJobData>) => {
      const { username } = job.data;
      const jobLog = logger.child({ jobId: job.id, username });
      jobLog.info('Processing scrape job');

      try {
        const rawPosts = await withTimeout(
          scrapeProfile(username, SCRAPE_TIMEOUT_MS, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD, redis),
          SCRAPE_TIMEOUT_MS + 10_000,
          `scrape @${username}`,
        );

        if (rawPosts.length === 0) {
          jobLog.info('No posts found');
          return;
        }

        // Store posts (duplicates are skipped via unique index)
        const storedPosts = await storeNewPosts(rawPosts);
        jobLog.info({ stored: storedPosts.length, total: rawPosts.length }, 'Stored posts');

        // Get account's lastPostId for dedup
        const account = await findAccountByUsername(username);
        const lastPostId = account?.lastPostId;

        // Find posts newer than account's cursor
        const newPosts = await getNewPostsSince(username, lastPostId);

        if (newPosts.length === 0) {
          jobLog.info('No new posts since last check');
          await updateLastScraped(username);
          return;
        }

        // Deliver new posts to ALL subscribers
        const subscribers = await getSubscribersByAccount(username);
        jobLog.info({ subscribers: subscribers.length, newPosts: newPosts.length }, 'Delivering');

        for (const sub of subscribers) {
          for (const post of newPosts) {
            await deliverQueue.add(
              `deliver-${username}-${sub.chatId}-${Date.now()}`,
              {
                chatId: sub.chatId,
                enqueuedAt: job.data.enqueuedAt,
                post: {
                  instagramUsername: post.instagramUsername,
                  caption: post.caption,
                  mediaUrl: post.mediaUrl,
                  mediaType: post.mediaType,
                  permalink: post.permalink,
                  videoUrl: post.videoUrl,
                  carouselMedia: post.carouselMedia,
                },
              },
              {
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 100 },
                attempts: 3,
                backoff: { type: 'exponential', delay: 30_000 },
              },
            );
          }
        }

        // Advance the account cursor to the newest post
        const newestPost = newPosts[newPosts.length - 1];
        await updateAccountLastPostId(username, newestPost.postId);
        await updateLastScraped(username);
        jobLog.info({ delivered: newPosts.length, to: subscribers.length }, 'Scrape complete');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jobLog.error({ err: message }, 'Failed to scrape');
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
    await closeDatabaseConnection();
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
