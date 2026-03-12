/**
 * Instagram session management: login via Playwright, persist storageState in Redis.
 *
 * Import-safe: no env.ts, no grammy, no fastify dependencies.
 * Takes a Redis instance as parameter for all storage operations.
 */

import type { Redis as RedisClient } from 'ioredis';
import type { Browser } from 'playwright';
import { createLogger } from '@app/shared';

const logger = createLogger({ name: 'session' });

const SESSION_KEY_PREFIX = 'ig:session:';
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Load a cached session from Redis. Returns the storageState JSON string or null.
 * Validates that the stored value is valid JSON; deletes corrupted entries.
 */
export const loadSession = async (
  redis: RedisClient,
  username: string,
): Promise<string | null> => {
  const raw = await redis.get(`${SESSION_KEY_PREFIX}${username}`);
  if (!raw) return null;
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    logger.error({ username }, 'Corrupted session, deleting');
    await redis.del(`${SESSION_KEY_PREFIX}${username}`);
    return null;
  }
};

/**
 * Save a session to Redis with a 24-hour TTL.
 */
export const saveSession = async (
  redis: RedisClient,
  username: string,
  storageState: string,
): Promise<void> => {
  await redis.set(`${SESSION_KEY_PREFIX}${username}`, storageState, 'EX', SESSION_TTL_SECONDS);
};

/**
 * Login to Instagram via Playwright and return the serialized storageState.
 */
export const loginWithPlaywright = async (
  browser: Browser,
  username: string,
  password: string,
  userAgent?: string,
): Promise<string> => {
  const context = await browser.newContext({
    ...(userAgent ? { userAgent } : {}),
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Accept cookies dialog if present (EU cookie consent can block the form)
    const cookieButton = page.locator('button:has-text("Allow all cookies"), button:has-text("Allow essential and optional cookies"), button:has-text("Accept")');
    if (await cookieButton.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cookieButton.first().click();
      await page.waitForTimeout(2_000);
    }

    // Fill credentials — Instagram uses name="email"/name="pass" (not "username"/"password")
    const usernameInput = page.locator('input[name="username"], input[name="email"]').first();
    await usernameInput.waitFor({ timeout: 15_000 });
    await usernameInput.fill(username);

    const passwordInput = page.locator('input[name="password"], input[name="pass"], input[type="password"]').first();
    await passwordInput.fill(password);

    // Submit — Instagram uses <div role="button" aria-label="Log In">
    const submitButton = page.getByRole('button', { name: 'Log In', exact: true });
    await submitButton.waitFor({ state: 'visible', timeout: 10_000 });
    await submitButton.click();

    // Wait for navigation away from login page
    await page.waitForURL((url) => !url.pathname.includes('/accounts/login'), {
      timeout: 30_000,
    });

    // Dismiss "Save login info" or "Turn on notifications" dialogs
    for (const label of ['Not Now', 'Not now']) {
      const btn = page.locator(`button:has-text("${label}")`);
      if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await btn.click();
      }
    }

    const state = await context.storageState();
    logger.info({ username }, 'Logged in');
    return JSON.stringify(state);
  } finally {
    await context.close();
  }
};
