/**
 * Instagram scraping logic: browser lifecycle + profile scraping.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { Redis } from 'ioredis';
import type { ScrapedPost } from './types.js';
import { extractPosts, extractPostsFromHtml } from './parser.js';
import { loadSession, saveSession, loginWithPlaywright } from './session.js';

let browser: Browser | null = null;

export const getBrowser = async (): Promise<Browser> => {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  browser.on('disconnected', () => {
    console.log('[scraper] Browser disconnected, will relaunch on next job');
    browser = null;
  });
  return browser;
};

export const closeBrowser = async (): Promise<void> => {
  if (browser) {
    await browser.close();
    browser = null;
  }
};

/**
 * Timeout helper
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
};

/**
 * Instagram session management
 */
let cachedStorageState: string | null = null;

export const initSession = async (
  redis: Redis,
  igUsername: string,
  igPassword: string,
): Promise<void> => {
  if (!igUsername || !igPassword) {
    console.log('[scraper] No Instagram credentials configured — scraping without auth');
    return;
  }

  const existing = await loadSession(redis, igUsername);
  if (existing) {
    cachedStorageState = existing;
    console.log(`[scraper] Loaded existing session for @${igUsername}`);
    return;
  }

  console.log(`[scraper] No cached session — logging in as @${igUsername}`);
  const b = await getBrowser();
  const state = await loginWithPlaywright(b, igUsername, igPassword);
  await saveSession(redis, igUsername, state);
  cachedStorageState = state;
};

export const refreshSession = async (
  redis: Redis,
  igUsername: string,
  igPassword: string,
): Promise<void> => {
  console.log(`[scraper] Refreshing session for @${igUsername}`);
  const b = await getBrowser();
  const state = await loginWithPlaywright(b, igUsername, igPassword);
  await saveSession(redis, igUsername, state);
  cachedStorageState = state;
};

/**
 * Scrape an Instagram profile for recent posts
 */
export const scrapeProfile = async (
  username: string,
  timeoutMs: number,
  igUsername: string,
  igPassword: string,
  redis: Redis,
  retry = true,
): Promise<ScrapedPost[]> => {
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
      try {
        contextOptions.storageState = JSON.parse(cachedStorageState);
      } catch {
        console.error('[scraper] Corrupted cached session, clearing');
        cachedStorageState = null;
      }
    }

    context = await b.newContext(contextOptions);

    const page = await context.newPage();
    const posts: ScrapedPost[] = [];

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
      timeout: timeoutMs,
    });

    // Wait for JS to execute API calls and intercept responses
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      console.log(`[scraper] networkidle timeout for @${username}, continuing`);
    });

    // Detect login wall — if redirected to login page, re-auth and retry once
    const currentUrl = page.url();
    if (currentUrl.includes('/accounts/login') && retry && igUsername) {
      console.log(`[scraper] Login wall detected for @${username} — re-authenticating`);
      await context.close();
      context = null;
      await refreshSession(redis, igUsername, igPassword);
      return scrapeProfile(username, timeoutMs, igUsername, igPassword, redis, false);
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
    if (context) await context.close().catch(() => {});
  }
};
