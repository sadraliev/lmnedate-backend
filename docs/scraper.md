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

## Important rules

- **Never use the same Instagram account for dev and prod** — Instagram binds the session to an IP and will block it when switching.
- **`SCRAPE_CONCURRENCY`** — at values > 1, all the race conditions above become relevant. The mutexes solve the problem, but for maximum reliability keep concurrency at 1.
- **Session is stored on disk** — `cachedSessionPath` points to a cookies file. When the container restarts, the session is lost and a new login is required.
