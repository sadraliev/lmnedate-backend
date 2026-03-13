# Scraper: internals and edge cases

## Architecture: browser, contexts, jobs

```
Chromium (single process — singleton)
├── Context 1 (job: @user_a)  ← isolated cookies & session
├── Context 2 (job: @user_b)  ← isolated cookies & session
└── Context 3 (job: @user_c)  ← isolated cookies & session
```

- **Browser** — one per worker process (`getBrowser()` returns a singleton).
- **Context** — created per job, like an incognito tab. Closed in `finally` after the job finishes.
- **Jobs** — BullMQ jobs, concurrency controlled via `SCRAPE_CONCURRENCY`.

## Race conditions under concurrency

### Double browser launch

**When**: `SCRAPE_CONCURRENCY > 1` and the browser isn't running yet (first start or after a crash).

**What happens without protection**: two jobs call `getBrowser()` simultaneously, both see `browser === null`, both call `chromium.launch()`. Two Chromium processes start, but only the last one gets stored in the `browser` variable. The first one leaks — it stays in memory as a zombie.

**Fix**: promise-based mutex. The first call stores the launch promise in `launchPromise`. All subsequent calls see the launch is already in progress and await the same promise.

```ts
let launchPromise: Promise<Browser> | null = null;

export const getBrowser = async () => {
  if (browser && browser.isConnected()) return browser; // already running
  if (launchPromise) return launchPromise;              // someone is already launching

  launchPromise = chromium.launch({ ... })
    .then((b) => { browser = b; launchPromise = null; return b; })
    .catch((err) => { launchPromise = null; throw err; });

  return launchPromise;
};
```

### Double Instagram login

**When**: two jobs hit the Instagram login wall at the same time.

**What happens without protection**: both call `refreshSession()`, both try to log into the same account in parallel. Instagram may flag the account for suspicious activity, or one session overwrites the other.

**Fix**: same mutex pattern — `refreshPromise`. The second call awaits the result of the first login.

## Zombie Chromium processes

**When**: the worker process crashes without SIGTERM — uncaught exception, OOM, unhandled rejection.

**What happens**: `SIGTERM`/`SIGINT` handlers don't fire, `closeBrowser()` is never called, the Chromium process keeps running.

**Fix**: additional handlers for `uncaughtException` and `unhandledRejection` that close the browser before calling `process.exit(1)`.

```ts
process.on('uncaughtException', async (err) => {
  await closeBrowser().catch(() => {});
  process.exit(1);
});
```

## Silent error swallowing

`context.close().catch(() => {})` — if the context fails to close, we never find out. Instead, we log the error via `logger.warn` so issues can be diagnosed.

## Adaptive throttling

The scraper tracks recent outcomes and adjusts its pacing automatically (`throttle.ts`). This prevents it from hammering Instagram during rate limits or bans.

### Sliding window

The last 20 job outcomes are stored in a Redis list (`scraper:outcomes`). Each outcome is one of:

| Outcome | When |
|---------|------|
| `success` | Posts were returned |
| `empty` | Profile loaded but zero posts found |
| `rate_limited` | Error contains `429` or `rate limit` |
| `banned` | Error contains `challenge`, `checkpoint`, or `suspended` |

Transient errors (network timeouts, DOM failures) are **not** recorded — they shouldn't influence the throttle.

### Interval adjustment

After each recorded outcome (once the window has at least 5 entries), the success rate is calculated and the interval is adjusted:

| Success rate | Action |
|-------------|--------|
| > 90% | Decrease interval by 10% (floor: 30 s) |
| 70–90% | No change |
| 50–70% | Increase by 50% |
| 30–50% | Double |
| < 30% | Double + emergency pause 15–30 min |

Interval is clamped to `[30s, 900s]`.

### Emergency pause

When success rate drops below 30%, all incoming jobs are deferred — the worker calls `job.moveToDelayed()` and throws `DelayedError` from BullMQ. This moves the job back to the delayed state **without consuming a retry attempt**, so it will be picked up again after the pause expires.

Pause duration is randomized between 15–30 minutes to avoid a thundering herd when the pause lifts.

### Redis keys

| Key | Type | Purpose |
|-----|------|---------|
| `scraper:outcomes` | list | Sliding window of last 20 outcomes |
| `scraper:interval_ms` | string | Current dynamic interval in ms |
| `scraper:paused_until` | string | Epoch ms when emergency pause ends |

These keys have **no TTL** by design. The learned interval must survive restarts — expiring it would reset the scraper to the aggressive default rate, potentially re-triggering the rate limits the throttle was protecting against. The pause key is already self-expiring in code (`getPauseRemaining()` checks the timestamp against `Date.now()`).

### Lifecycle

- `initThrottle(redisUrl)` is called at startup (after DB connect)
- `closeThrottle()` is called during graceful shutdown
- The throttle uses its own ioredis connection, separate from BullMQ's

## Important rules

- **Never use the same Instagram account for dev and prod** — Instagram binds the session to an IP and will block it when switching.
- **`SCRAPE_CONCURRENCY`** — at values > 1, all the race conditions above become relevant. The mutexes solve the problem, but for maximum reliability keep concurrency at 1.
- **Session is stored on disk** — `cachedSessionPath` points to a cookies file. When the container restarts, the session is lost and a new login is required.
