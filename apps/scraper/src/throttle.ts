/**
 * Adaptive throttling based on scrape success rate.
 *
 * Tracks outcomes in a Redis-backed sliding window and adjusts the
 * scrape interval dynamically.  When failure rate is critically high
 * an emergency pause is triggered.
 */

import { Redis } from 'ioredis';
import { parseRedisUrl } from '@app/shared';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------
export type Outcome = 'success' | 'empty' | 'rate_limited' | 'banned';

const WINDOW_SIZE = 20;
const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 900_000;
const PAUSE_MIN_MS = 15 * 60_000; // 15 min
const PAUSE_MAX_MS = 30 * 60_000; // 30 min

// Redis keys
const KEY_OUTCOMES = 'scraper:outcomes';
const KEY_INTERVAL = 'scraper:interval_ms';
const KEY_PAUSED = 'scraper:paused_until';

// ---------------------------------------------------------------------------
// Module-level Redis client
// ---------------------------------------------------------------------------
let redis: Redis | null = null;

export const initThrottle = (redisUrl: string): void => {
  const cfg = parseRedisUrl(redisUrl);
  redis = new Redis({
    host: cfg.host,
    port: cfg.port,
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.username ? { username: cfg.username } : {}),
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  redis.connect().catch(() => {});
};

export const closeThrottle = async (): Promise<void> => {
  if (redis) {
    await redis.quit();
    redis = null;
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const randomPause = () =>
  PAUSE_MIN_MS + Math.floor(Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record an outcome and recalculate the scrape interval.
 */
export const recordOutcome = async (outcome: Outcome): Promise<void> => {
  if (!redis) return;

  // Push outcome into sliding window (most recent first)
  await redis.lpush(KEY_OUTCOMES, outcome);
  await redis.ltrim(KEY_OUTCOMES, 0, WINDOW_SIZE - 1);

  // Fetch current window
  const window = await redis.lrange(KEY_OUTCOMES, 0, WINDOW_SIZE - 1);
  if (window.length < 5) return; // not enough data yet

  const successes = window.filter((o: string) => o === 'success').length;
  const rate = successes / window.length;

  const currentRaw = await redis.get(KEY_INTERVAL);
  let interval = currentRaw ? parseInt(currentRaw, 10) : DEFAULT_INTERVAL_MS;
  if (Number.isNaN(interval)) interval = DEFAULT_INTERVAL_MS;

  if (rate > 0.9) {
    // > 90% success — speed up
    interval = Math.round(interval * 0.9);
  } else if (rate >= 0.7) {
    // 70–90% — keep current
  } else if (rate >= 0.5) {
    // 50–70% — increase by 50%
    interval = Math.round(interval * 1.5);
  } else if (rate >= 0.3) {
    // 30–50% — double
    interval = interval * 2;
  } else {
    // < 30% — double + emergency pause
    interval = interval * 2;
    const pauseUntil = Date.now() + randomPause();
    await redis.set(KEY_PAUSED, String(pauseUntil));
  }

  interval = clamp(interval, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  await redis.set(KEY_INTERVAL, String(interval));
};

/**
 * Trigger an immediate emergency pause (for critical ban signals).
 */
export const triggerEmergencyPause = async (): Promise<void> => {
  if (!redis) return;
  const pauseUntil = Date.now() + randomPause();
  await redis.set(KEY_PAUSED, String(pauseUntil));
};

/**
 * Returns ms remaining in emergency pause, or 0 if not paused.
 */
export const getPauseRemaining = async (): Promise<number> => {
  if (!redis) return 0;
  const raw = await redis.get(KEY_PAUSED);
  if (!raw) return 0;
  const remaining = parseInt(raw, 10) - Date.now();
  return remaining > 0 ? remaining : 0;
};

/**
 * Returns the current dynamic interval in ms.
 */
export const getCurrentInterval = async (): Promise<number> => {
  if (!redis) return DEFAULT_INTERVAL_MS;
  const raw = await redis.get(KEY_INTERVAL);
  if (!raw) return DEFAULT_INTERVAL_MS;
  const val = parseInt(raw, 10);
  return Number.isNaN(val) ? DEFAULT_INTERVAL_MS : val;
};
