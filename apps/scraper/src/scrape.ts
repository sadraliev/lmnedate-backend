/**
 * Instagram scraping logic: browser lifecycle + profile scraping.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { APIRequestContext } from 'playwright';
import type { ScrapedPost } from './types.js';
import { extractPosts, extractPostsFromHtml, findNestedValue } from './parser.js';
import { loadSession, loginWithPlaywright } from './session.js';
import { FINGERPRINT, EXTRA_HEADERS, applyStealthScripts } from './stealth.js';
import { humanScroll } from './humanizer.js';
import { createLogger } from '@app/shared';

const logger = createLogger({ name: 'scraper' });

const API_HEADERS = {
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': '*/*',
  'Accept-Language': EXTRA_HEADERS['Accept-Language'],
} as const;

let browser: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;

export const getBrowser = async (): Promise<Browser> => {
  if (browser && browser.isConnected()) return browser;
  if (launchPromise) return launchPromise;

  launchPromise = chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--enable-unsafe-swiftshader',
    ],
  }).then((b) => {
    browser = b;
    b.on('disconnected', () => {
      logger.info('Browser disconnected, will relaunch on next job');
      browser = null;
    });
    launchPromise = null;
    return b;
  }).catch((err) => {
    launchPromise = null;
    throw err;
  });

  return launchPromise;
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
 * Instagram session management (file-based)
 */
let cachedSessionPath: string | null = null;

export const initSession = async (
  igUsername: string,
  igPassword: string,
): Promise<void> => {
  if (!igUsername || !igPassword) {
    logger.info('No Instagram credentials configured — scraping without auth');
    return;
  }

  const existing = await loadSession();
  if (existing) {
    cachedSessionPath = existing;
    logger.info({ igUsername }, 'Loaded existing session from file');
    return;
  }

  logger.info({ igUsername }, 'No cached session — logging in');
  const b = await getBrowser();
  cachedSessionPath = await loginWithPlaywright(b, igUsername, igPassword);
};

let refreshPromise: Promise<void> | null = null;

export const refreshSession = async (
  igUsername: string,
  igPassword: string,
): Promise<void> => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    logger.info({ igUsername }, 'Refreshing session');
    const b = await getBrowser();
    cachedSessionPath = await loginWithPlaywright(b, igUsername, igPassword);
  })().finally(() => { refreshPromise = null; });

  return refreshPromise;
};

/**
 * Enrich posts missing engagement data via Instagram's mobile feed API.
 * Uses context.request (Playwright APIRequestContext) instead of page.evaluate(fetch).
 */
const enrichPostsWithApi = async (
  posts: ScrapedPost[],
  request: APIRequestContext,
  username: string,
): Promise<void> => {
  const unenriched = posts.filter((p) => p.likesCount === undefined);
  if (unenriched.length === 0) return;

  logger.info({ username, count: unenriched.length }, 'Enriching posts via mobile feed API');

  try {
    // Step 1: resolve username → user_id
    const profileRes = await request.get(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      { headers: API_HEADERS },
    );

    if (!profileRes.ok()) {
      logger.info({ username }, 'Could not resolve user_id — skipping enrichment');
      return;
    }

    const profileJson = (await profileRes.json()) as { data?: { user?: { id?: string } } };
    const userId = profileJson?.data?.user?.id ?? null;

    if (!userId) {
      logger.info({ username }, 'Could not resolve user_id — skipping enrichment');
      return;
    }

    // Step 2: fetch feed
    const feedRes = await request.get(
      `https://i.instagram.com/api/v1/feed/user/${userId}/?count=12`,
      { headers: API_HEADERS },
    );

    if (!feedRes.ok()) {
      logger.info({ username }, 'Feed API returned non-200 — skipping enrichment');
      return;
    }

    const feedJson = await feedRes.json();

    const apiItemCount = Array.isArray(feedJson.items) ? feedJson.items.length : 0;
    logger.debug({ username, feedKeys: Object.keys(feedJson), apiItemCount }, 'Feed API response shape');

    // Parse feed items into enriched posts
    const enrichedPosts: ScrapedPost[] = [];
    extractPosts(feedJson, username, enrichedPosts);

    logger.debug({ username, parsedCount: enrichedPosts.length, sample: enrichedPosts[0] ? { postId: enrichedPosts[0].postId, likesCount: enrichedPosts[0].likesCount, commentsCount: enrichedPosts[0].commentsCount, caption: enrichedPosts[0].caption?.slice(0, 80) } : null }, 'Parsed enrichment posts');

    // Build a lookup by postId (shortcode) for fast matching
    const enrichedByCode = new Map<string, ScrapedPost>();
    for (const ep of enrichedPosts) {
      const match = ep.permalink.match(/\/(p|reel)\/([^/]+)/);
      if (match) enrichedByCode.set(match[2], ep);
    }

    logger.debug({ username, enrichedCodes: [...enrichedByCode.keys()], unenrichedIds: unenriched.map((p) => p.postId) }, 'Matching enriched → unenriched');

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

    logger.info({ username, apiItems: apiItemCount, parsed: enrichedPosts.length, matched: count, total: unenriched.length }, 'Enrichment complete');
  } catch (err) {
    logger.warn({ username, err: err instanceof Error ? err.message : err }, 'Enrichment failed');
  }
};

/**
 * Fallback: enrich the latest post by navigating the existing page to the post
 * URL and extracting embedded JSON from the HTML.
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
  retry = true,
): Promise<ScrapedPost[]> => {
  let context: BrowserContext | null = null;
  try {
    const b = await getBrowser();

    const contextOptions: Record<string, unknown> = {
      userAgent: FINGERPRINT.userAgent,
      viewport: FINGERPRINT.viewport,
      locale: FINGERPRINT.locale,
      timezoneId: FINGERPRINT.timezoneId,
      extraHTTPHeaders: EXTRA_HEADERS,
    };

    if (cachedSessionPath) {
      contextOptions.storageState = cachedSessionPath;
    }

    context = await b.newContext(contextOptions);

    const page = await context.newPage();
    await applyStealthScripts(page);
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

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      logger.debug({ username }, 'networkidle timeout, continuing');
    });

    const currentUrl = page.url();
    const pageTitle = await page.title();
    logger.info({ username, url: currentUrl, title: pageTitle }, 'Page loaded');

    // Detect login wall — re-auth and retry once
    if (currentUrl.includes('/accounts/login') && retry && igUsername) {
      logger.info({ username }, 'Login wall detected — re-authenticating');
      await context.close();
      context = null;
      await refreshSession(igUsername, igPassword);
      return scrapeProfile(username, timeoutMs, igUsername, igPassword, false);
    }

    // Scroll down to trigger lazy loading
    if (posts.length === 0) {
      await humanScroll(page);
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    }

    if (posts.length === 0) {
      const pageContent = await page.content();
      extractPostsFromHtml(pageContent, username, posts);
    }

    // Fallback: extract posts directly from the DOM
    if (posts.length === 0) {
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

    // Enrich posts via context.request (inherits cookies from context)
    await enrichPostsWithApi(posts, context.request, username);

    // Fallback: if the latest post is still unenriched, navigate to its page
    if (posts.length > 0 && posts[0].likesCount === undefined) {
      await enrichLatestPostViaPage(posts[0], page, username);
    }

    // Prefer enriched posts, then sort by timestamp descending
    posts.sort((a, b) => {
      const aEnriched = a.likesCount !== undefined ? 1 : 0;
      const bEnriched = b.likesCount !== undefined ? 1 : 0;
      if (aEnriched !== bEnriched) return bEnriched - aEnriched;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    return posts.slice(0, 12);
  } finally {
    if (context) await context.close().catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'Failed to close context');
    });
  }
};
