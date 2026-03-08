/**
 * Docker entry point for the Instagram scraper worker.
 *
 * PoC: no MongoDB, sessions in Redis, scrape → deliver queue with post data.
 *
 * Import isolation: this file does NOT import env.ts, telegram.service.ts,
 * telegram.bot.ts, fastify, or grammy. It only uses:
 *   - instagram.parser.ts (pure parsing functions)
 *   - instagram.session.ts (Redis-based session)
 *   - jobs/queue-names.ts (constants)
 *   - jobs/job-types.ts (types)
 *   - config/redis-standalone.ts (pure function)
 */

import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { Redis } from 'ioredis';
import { QUEUE_NAMES } from './shared/jobs/queue-names.js';
import type { ScrapeJobData, DeliverJobData } from './shared/jobs/job-types.js';
import { parseRedisUrl } from './shared/config/redis-standalone.js';
import { extractPosts, extractPostsFromHtml } from './modules/instagram/instagram.parser.js';
import { loadSession, saveSession, loginWithPlaywright } from './modules/instagram/instagram.session.js';
import type { InstagramPost } from './modules/telegram/telegram.types.js';

// ---------------------------------------------------------------------------
// Config from environment (no env.ts dependency)
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const SCRAPE_CONCURRENCY = parseInt(process.env.SCRAPE_CONCURRENCY ?? '1', 10);
const SCRAPE_TIMEOUT_MS = parseInt(process.env.SCRAPE_TIMEOUT_MS ?? '30000', 10);
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME ?? '';
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD ?? '';

const redisConfig = parseRedisUrl(REDIS_URL);

// ---------------------------------------------------------------------------
// Redis connection for session storage
// ---------------------------------------------------------------------------
let redis: Redis;

const connectRedis = (): Redis => {
  redis = new Redis(REDIS_URL);
  console.log(`[scraper] Connected to Redis`);
  return redis;
};

// ---------------------------------------------------------------------------
// Instagram session (storageState for authenticated scraping)
// ---------------------------------------------------------------------------
let cachedStorageState: string | null = null;

const initSession = async (): Promise<void> => {
  if (!INSTAGRAM_USERNAME || !INSTAGRAM_PASSWORD) {
    console.log('[scraper] No Instagram credentials configured — scraping without auth');
    return;
  }

  const existing = await loadSession(redis, INSTAGRAM_USERNAME);
  if (existing) {
    cachedStorageState = existing;
    console.log(`[scraper] Loaded existing session for @${INSTAGRAM_USERNAME}`);
    return;
  }

  console.log(`[scraper] No cached session — logging in as @${INSTAGRAM_USERNAME}`);
  const b = await getBrowser();
  const state = await loginWithPlaywright(b, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD);
  await saveSession(redis, INSTAGRAM_USERNAME, state);
  cachedStorageState = state;
};

const refreshSession = async (): Promise<void> => {
  console.log(`[scraper] Refreshing session for @${INSTAGRAM_USERNAME}`);
  const b = await getBrowser();
  const state = await loginWithPlaywright(b, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD);
  await saveSession(redis, INSTAGRAM_USERNAME, state);
  cachedStorageState = state;
};

// ---------------------------------------------------------------------------
// Playwright browser
// ---------------------------------------------------------------------------
let browser: Browser | null = null;

const getBrowser = async (): Promise<Browser> => {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
};

const closeBrowser = async (): Promise<void> => {
  if (browser) {
    await browser.close();
    browser = null;
  }
};

// ---------------------------------------------------------------------------
// Scraping logic
// ---------------------------------------------------------------------------
const scrapeProfile = async (
  username: string,
  retry = true,
): Promise<Omit<InstagramPost, '_id'>[]> => {
  let context: BrowserContext | null = null;
  try {
    const b = await getBrowser();

    const contextOptions: Record<string, unknown> = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    };

    if (cachedStorageState) {
      contextOptions.storageState = JSON.parse(cachedStorageState);
    }

    context = await b.newContext(contextOptions);

    const page = await context.newPage();
    const posts: Omit<InstagramPost, '_id'>[] = [];

    page.on('response', async (response) => {
      const url = response.url();
      const isRelevant =
        url.includes('/graphql/query') ||
        url.includes('/api/v1/') ||
        url.includes('graphql') ||
        url.includes('timeline') ||
        url.includes('feed');
      if (!isRelevant) return;
      try {
        const contentType = response.headers()['content-type'] ?? '';
        if (!contentType.includes('json') && !contentType.includes('text')) return;
        const json = await response.json();
        extractPosts(json, username, posts);
      } catch {
        // Not JSON — ignore
      }
    });

    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'domcontentloaded',
      timeout: SCRAPE_TIMEOUT_MS,
    });

    // Wait for JS to execute API calls and intercept responses
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      console.log(`[scraper] networkidle timeout for @${username}, continuing`);
    });

    // Detect login wall — if redirected to login page, re-auth and retry once
    const currentUrl = page.url();
    if (currentUrl.includes('/accounts/login') && retry && INSTAGRAM_USERNAME) {
      console.log(`[scraper] Login wall detected for @${username} — re-authenticating`);
      await context.close();
      context = null;
      await refreshSession();
      return scrapeProfile(username, false);
    }

    if (posts.length === 0) {
      const pageContent = await page.content();
      extractPostsFromHtml(pageContent, username, posts);
    }

    // Fallback: extract posts directly from the DOM
    if (posts.length === 0) {
      console.log(`[scraper] No posts from intercept/HTML for @${username}, trying DOM extraction...`);
      const domPosts = await page.$$eval(
        'a[href*="/p/"], a[href*="/reel/"]',
        (links) => {
          const results: { permalink: string; mediaUrl: string; shortcode: string }[] = [];
          const seen = new Set<string>();
          for (const link of links) {
            const href = (link as unknown as { href: string }).href;
            const match = href.match(/\/(p|reel)\/([^/]+)/);
            if (!match) continue;
            const shortcode = match[2];
            if (seen.has(shortcode)) continue;
            seen.add(shortcode);
            const img = link.querySelector('img');
            results.push({ permalink: href, mediaUrl: img?.src ?? '', shortcode });
          }
          return results;
        },
      );

      for (const dp of domPosts) {
        posts.push({
          instagramUsername: username,
          postId: dp.shortcode,
          caption: undefined,
          mediaUrl: dp.mediaUrl,
          mediaType: dp.permalink.includes('/reel/') ? 'video' : 'image',
          permalink: dp.permalink,
          timestamp: new Date(),
          createdAt: new Date(),
        });
      }
      console.log(`[scraper] DOM extraction found ${domPosts.length} posts for @${username}`);
    }

    return posts.slice(0, 12);
  } finally {
    if (context) await context.close();
  }
};

// ---------------------------------------------------------------------------
// BullMQ Worker
// ---------------------------------------------------------------------------
const main = async () => {
  connectRedis();
  await initSession();

  const deliverQueue = new Queue<DeliverJobData>(QUEUE_NAMES.INSTAGRAM_DELIVER, {
    connection: { host: redisConfig.host, port: redisConfig.port },
  });

  const worker = new Worker<ScrapeJobData>(
    QUEUE_NAMES.INSTAGRAM_SCRAPE,
    async (job: Job<ScrapeJobData>) => {
      const { username, chatId } = job.data;
      console.log(`[scraper] Processing scrape job for @${username} (chatId=${chatId})`);

      try {
        const rawPosts = await scrapeProfile(username);

        if (rawPosts.length === 0) {
          console.log(`[scraper] No posts found for @${username}`);
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
        console.log(`[scraper] Enqueued delivery for @${username} → chatId=${chatId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[scraper] Failed to scrape @${username}:`, message);
        await deliverQueue.add(
          `deliver-error-${username}-${Date.now()}`,
          { chatId, error: `Failed to fetch @${username}: ${message}` },
          { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
        );
        throw error;
      }
    },
    {
      connection: { host: redisConfig.host, port: redisConfig.port },
      concurrency: SCRAPE_CONCURRENCY,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[scraper] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[scraper] Job ${job?.id} failed:`, err.message);
  });

  console.log(`[scraper] Worker started (concurrency=${SCRAPE_CONCURRENCY}, timeout=${SCRAPE_TIMEOUT_MS}ms)`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[scraper] Received ${signal}, shutting down...`);
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
  console.error('[scraper] Fatal error:', err);
  process.exit(1);
});
