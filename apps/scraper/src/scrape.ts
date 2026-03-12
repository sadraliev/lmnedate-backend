/**
 * Instagram scraping logic: browser lifecycle + profile scraping.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Redis } from 'ioredis';
import type { ScrapedPost } from './types.js';
import { extractPosts, extractPostsFromHtml, findNestedValue } from './parser.js';
import { loadSession, saveSession, loginWithPlaywright } from './session.js';
import { createLogger } from '@app/shared';

const logger = createLogger({ name: 'scraper' });

const COMMON_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let browser: Browser | null = null;

export const getBrowser = async (): Promise<Browser> => {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  browser.on('disconnected', () => {
    logger.info('Browser disconnected, will relaunch on next job');
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
    logger.info('No Instagram credentials configured — scraping without auth');
    return;
  }

  const existing = await loadSession(redis, igUsername);
  if (existing) {
    cachedStorageState = existing;
    logger.info({ igUsername }, 'Loaded existing session');
    return;
  }

  logger.info({ igUsername }, 'No cached session — logging in');
  const b = await getBrowser();
  const state = await loginWithPlaywright(b, igUsername, igPassword, COMMON_USER_AGENT);
  await saveSession(redis, igUsername, state);
  cachedStorageState = state;
};

export const refreshSession = async (
  redis: Redis,
  igUsername: string,
  igPassword: string,
): Promise<void> => {
  logger.info({ igUsername }, 'Refreshing session');
  const b = await getBrowser();
  const state = await loginWithPlaywright(b, igUsername, igPassword, COMMON_USER_AGENT);
  await saveSession(redis, igUsername, state);
  cachedStorageState = state;
};

/**
 * Enrich posts missing engagement data via Instagram's mobile feed API.
 * Two steps: resolve username → user_id, then fetch the feed.
 * Runs fetch inside the browser context to inherit cookies + TLS fingerprint.
 * Best-effort — on failure, posts keep their existing data.
 */
const enrichPostsWithApi = async (
  posts: ScrapedPost[],
  page: Page,
  username: string,
): Promise<void> => {
  const unenriched = posts.filter((p) => p.likesCount === undefined);
  if (unenriched.length === 0) return;

  logger.info({ username, count: unenriched.length }, 'Enriching posts via mobile feed API');

  try {
    // Step 1: resolve username → user_id
    const userId = await page.evaluate(async (user: string) => {
      const res = await fetch(
        `https://i.instagram.com/api/v1/users/web_profile_info/?username=${user}`,
        { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { user?: { id?: string } } };
      return json?.data?.user?.id ?? null;
    }, username);

    if (!userId) {
      logger.info({ username }, 'Could not resolve user_id — skipping enrichment');
      return;
    }

    // Step 2: fetch feed (single API call returns all posts)
    const feedJson = await page.evaluate(async (uid: string) => {
      const res = await fetch(
        `https://i.instagram.com/api/v1/feed/user/${uid}/?count=12`,
        { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } },
      );
      if (!res.ok) return null;
      return res.json();
    }, userId);

    if (!feedJson) {
      logger.info({ username }, 'Feed API returned non-200 — skipping enrichment');
      return;
    }

    // Parse feed items into enriched posts
    const enrichedPosts: ScrapedPost[] = [];
    extractPosts(feedJson, username, enrichedPosts);

    // Build a lookup by postId (shortcode) for fast matching
    const enrichedByCode = new Map<string, ScrapedPost>();
    for (const ep of enrichedPosts) {
      // Feed items use numeric pk as postId, but DOM posts use shortcode.
      // Match by permalink shortcode instead.
      const match = ep.permalink.match(/\/(p|reel)\/([^/]+)/);
      if (match) enrichedByCode.set(match[2], ep);
    }

    let count = 0;
    for (const post of unenriched) {
      const e = enrichedByCode.get(post.postId);
      if (!e) continue;

      post.likesCount = e.likesCount;
      post.commentsCount = e.commentsCount;
      post.videoViewsCount = e.videoViewsCount;
      post.videoUrl = e.videoUrl;
      post.carouselMedia = e.carouselMedia;
      post.hashtags = e.hashtags;
      post.mentions = e.mentions;
      post.location = e.location;
      if (e.timestamp.getTime() > 0) post.timestamp = e.timestamp;
      if (e.caption) post.caption = e.caption;
      if (e.mediaUrl) post.mediaUrl = e.mediaUrl;
      if (e.mediaType) post.mediaType = e.mediaType;
      count++;
    }

    logger.info({ username, enriched: count, total: unenriched.length }, 'Enrichment complete');
  } catch (err) {
    logger.warn({ username, err: err instanceof Error ? err.message : err }, 'Enrichment failed');
  }
};

/**
 * Fallback: enrich the latest post by navigating the existing page to the post
 * URL and extracting embedded JSON from the HTML. Instagram embeds post data as
 * API v1 items under `xdt_api__v1__media__shortcode__web_info` in script tags.
 * Reuses the same page to preserve session cookies and browser state.
 */
const enrichLatestPostViaPage = async (
  post: ScrapedPost,
  page: Page,
  username: string,
): Promise<void> => {
  logger.info({ postId: post.postId }, 'Enriching latest post via page navigation');

  try {
    await page.goto(post.permalink, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Extract embedded post data from the raw HTML.
    // Instagram embeds API v1 data in <script type="application/json"> tags
    // under the key xdt_api__v1__media__shortcode__web_info.
    const html = await page.content();
    const scriptRegex = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
    let embeddedJson: unknown = null;
    let scriptMatch: RegExpExecArray | null;

    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      const text = scriptMatch[1];
      if (!text.includes('xdt_api__v1__media__shortcode__web_info') || !text.includes(post.postId)) continue;
      try {
        const parsed = JSON.parse(text);
        const webInfo = findNestedValue(parsed, 'xdt_api__v1__media__shortcode__web_info');
        if (webInfo) {
          embeddedJson = webInfo;
          break;
        }
      } catch {
        // JSON parse error — skip
      }
    }

    if (embeddedJson) {
      const parsed: ScrapedPost[] = [];
      extractPosts(embeddedJson, username, parsed);

      if (parsed.length > 0) {
        const e = parsed[0];
        post.likesCount = e.likesCount;
        post.commentsCount = e.commentsCount;
        post.videoViewsCount = e.videoViewsCount;
        post.videoUrl = e.videoUrl;
        post.carouselMedia = e.carouselMedia;
        post.hashtags = e.hashtags;
        post.mentions = e.mentions;
        post.location = e.location;
        if (e.timestamp.getTime() > 0) post.timestamp = e.timestamp;
        if (e.caption) post.caption = e.caption;
        if (e.mediaUrl) post.mediaUrl = e.mediaUrl;
        if (e.mediaType) post.mediaType = e.mediaType;
        logger.info({ postId: post.postId }, 'Latest post enriched via page navigation');
        return;
      }
    }

    logger.info({ postId: post.postId }, 'No embedded post data found');
  } catch (err) {
    logger.warn({ postId: post.postId, err: err instanceof Error ? err.message : err }, 'Page enrichment failed');
  }
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
      userAgent: COMMON_USER_AGENT,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    };

    if (cachedStorageState) {
      try {
        contextOptions.storageState = JSON.parse(cachedStorageState);
      } catch {
        logger.error('Corrupted cached session, clearing');
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
      logger.debug({ username }, 'networkidle timeout, continuing');
    });

    // Debug: log page state
    const currentUrl = page.url();
    const pageTitle = await page.title();
    logger.info({ username, url: currentUrl, title: pageTitle }, 'Page loaded');

    // Detect login wall — if redirected to login page, re-auth and retry once
    if (currentUrl.includes('/accounts/login') && retry && igUsername) {
      logger.info({ username }, 'Login wall detected — re-authenticating');
      await context.close();
      context = null;
      await refreshSession(redis, igUsername, igPassword);
      return scrapeProfile(username, timeoutMs, igUsername, igPassword, redis, false);
    }

    // Scroll down to trigger lazy loading of posts grid
    if (posts.length === 0) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(3_000);
      // Wait for any new network requests triggered by scroll
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    }

    if (posts.length === 0) {
      const pageContent = await page.content();
      extractPostsFromHtml(pageContent, username, posts);
    }

    // Fallback: extract posts directly from the DOM
    if (posts.length === 0) {
      // Debug: log page structure to diagnose rendering issues
      const debugInfo = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        const articles = document.querySelectorAll('article');
        const mainContent = document.querySelector('main');
        const bodyText = document.body?.innerText?.slice(0, 500) ?? '';
        return {
          postLinks: allLinks.length,
          articles: articles.length,
          hasMain: !!mainContent,
          bodyPreview: bodyText,
        };
      });
      logger.info({ username, ...debugInfo }, 'Debug: page DOM state');
      logger.info({ username }, 'No posts from intercept/HTML, trying DOM extraction');
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
      logger.info({ username, count: domPosts.length }, 'DOM extraction complete');
    }

    // Enrich posts that are missing engagement data
    await enrichPostsWithApi(posts, page, username);

    // Fallback: if the latest post is still unenriched, navigate to its page
    if (posts.length > 0 && posts[0].likesCount === undefined) {
      await enrichLatestPostViaPage(posts[0], page, username);
    }

    // Sort by timestamp descending so the latest post is first, not the pinned one
    posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return posts.slice(0, 12);
  } finally {
    if (context) await context.close().catch(() => {});
  }
};
