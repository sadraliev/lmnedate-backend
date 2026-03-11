import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import {
  QUEUE_NAMES,
  createRedisConnection,
  createLogger,
  connectToDatabase,
  closeDatabaseConnection,
  getDatabase,
  findAccountByUsername,
} from '@app/shared';
import type { ScrapeJobData } from '@app/shared';

const logger = createLogger({ name: 'scheduler' });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27019/instagram-scraper';
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const main = async () => {
  // Connect to MongoDB
  await connectToDatabase(MONGODB_URI);
  logger.info('Connected to MongoDB');

  const connection = createRedisConnection(REDIS_URL, 'scheduler', logger);

  // Queue for the repeatable poll job
  const pollQueue = new Queue(QUEUE_NAMES.INSTAGRAM_POLL, { connection });

  // Queue to enqueue scrape jobs
  const scrapeQueue = new Queue<ScrapeJobData>(QUEUE_NAMES.INSTAGRAM_SCRAPE, { connection });

  // Upsert the repeatable job (idempotent — safe to call on every startup)
  await pollQueue.upsertJobScheduler(
    'instagram-poll-scheduler',
    { every: POLL_INTERVAL_MS },
    { name: 'poll-tick' },
  );
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Repeatable poll job registered');

  // Worker that processes each poll tick
  const worker = new Worker(
    QUEUE_NAMES.INSTAGRAM_POLL,
    async (_job: Job) => {
      const db = getDatabase();

      // 1. Get distinct active Instagram usernames from subscriptions
      const activeUsernames: string[] = await db
        .collection('subscriptions')
        .distinct('instagramUsername', { isActive: true });

      if (activeUsernames.length === 0) {
        logger.info('No active subscriptions, skipping poll');
        return;
      }

      let totalJobs = 0;
      let accountCount = 0;

      for (const username of activeUsernames) {
        // 2. Check if account is scrapeable
        const account = await findAccountByUsername(username);
        if (!account || account.status !== 'scrapeable') {
          logger.debug({ username, status: account?.status }, 'Skipping non-scrapeable account');
          continue;
        }

        // 3. Get all active subscriber chatIds for this account
        const subscriptions = await db
          .collection('subscriptions')
          .find({ instagramUsername: username, isActive: true })
          .project<{ chatId: number }>({ chatId: 1 })
          .toArray();

        // 4. Enqueue a scrape job for each subscriber
        const jobs = subscriptions.map((sub) => ({
          name: `scrape-${username}-${sub.chatId}-${Date.now()}`,
          data: {
            username,
            chatId: sub.chatId,
            enqueuedAt: new Date().toISOString(),
          } satisfies ScrapeJobData,
          opts: {
            removeOnComplete: { count: 50 } as const,
            removeOnFail: { count: 100 } as const,
            attempts: 3,
            backoff: { type: 'exponential' as const, delay: 30_000 },
          },
        }));

        if (jobs.length > 0) {
          await scrapeQueue.addBulk(jobs);
          accountCount++;
          totalJobs += jobs.length;
        }
      }

      logger.info({ totalJobs, accountCount }, 'Enqueued scrape jobs');
    },
    { connection },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Poll tick completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Poll tick failed');
  });

  logger.info('Scheduler started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await worker.close();
    await scrapeQueue.close();
    await pollQueue.close();
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
