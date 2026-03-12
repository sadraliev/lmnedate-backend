# Postergeist

Instagram scraper with Telegram delivery. Monitors public profiles, extracts posts via Playwright, and delivers them to Telegram chats through BullMQ job queues.

## Features

- **Telegram bot** — `/start`, `/update <username>`, `/stats`
- **Instagram scraper** — Playwright-based with file-based session, login wall detection, and DOM/API fallbacks
- **Post enrichment** — engagement data (likes, comments, views) via `context.request` API + page navigation fallback
- **Job queues** — BullMQ for scrape and deliver pipelines with retry/backoff
- **Single process bot** — bot + deliver worker + scheduler in one process
- **Structured logging** — pino with JSON in production, pretty-printed in dev

## Quick Start

```bash
# Install dependencies
pnpm install

# Start infrastructure (MongoDB, Redis, Bull Board, Scraper)
make up

# Copy and configure environment
cp .env.example .env

# Run bot natively (bot + deliver + scheduler)
make dev-bot

# Or run everything
make dev
```

## Project Structure

```
packages/shared/              # @app/shared — shared library
├── src/
│   ├── logger.ts             # createLogger factory (pino)
│   ├── redis.ts              # Redis connection config for BullMQ
│   ├── queue-names.ts        # BullMQ queue name constants
│   ├── job-types.ts          # ScrapeJobData, DeliverJobData
│   ├── post-types.ts         # ScrapedPost, CarouselMediaItem
│   ├── parser.ts             # Instagram JSON/HTML post extraction
│   ├── caption-utils.ts      # Hashtag/mention extraction
│   └── database/             # MongoDB repositories (accounts, posts, subscriptions)

apps/bot/                     # @app/bot — unified process
├── src/
│   ├── main.ts               # Entrypoint: bot + deliver worker + scheduler
│   └── bot-instance.ts       # Shared Grammy bot instance

apps/scraper/                 # @app/scraper — Playwright scraper (runs in Docker)
├── src/
│   ├── worker.ts             # BullMQ consumer, job processing
│   ├── scrape.ts             # Browser lifecycle, profile scraping, enrichment
│   ├── session.ts            # Instagram login + file-based session persistence
│   ├── parser.ts             # Post extraction (re-exports from shared)
│   └── types.ts              # ScrapedPost type

scripts/                      # Utility scripts (trigger-poll, enqueue-scrape, etc.)
```

## How the Scraper Works

### Architecture

```
Bot process (native)                    Scraper (Docker + Playwright)
┌──────────────────────┐                ┌──────────────────────┐
│  Grammy bot          │                │  BullMQ worker       │
│  Deliver worker      │  ◄── Redis ──► │  Playwright browser  │
│  Scheduler (15 min)  │                │  File-based session  │
└──────────────────────┘                └──────────────────────┘
         │                                        │
         └──────────── MongoDB ◄──────────────────┘
```

Scheduler (in bot) enqueues scrape jobs every 15 minutes. Scraper processes them,
stores posts in MongoDB, enqueues deliver jobs. Bot's deliver worker sends posts
to Telegram subscribers.

### Browser Lifecycle

One **Browser** instance per process (singleton via `getBrowser()`). Persists across
jobs, recreated only on disconnect. Each **job** gets its own **BrowserContext**
(lightweight, like an incognito tab) with session cookies from `ig-session.json`.

```
Browser (1 per process, reused across jobs)
  └── BrowserContext (1 per job, loaded with cookies)
        └── Page (1 per context, used for navigation + interception)
```

### Session Management

Sessions are stored as files (`ig-session.json`) — Playwright `storageState` format
(cookies + localStorage).

- **Startup**: `initSession()` checks if file exists and is valid JSON → reuse
- **No file**: `loginWithPlaywright()` fills login form → `context.storageState({path})` saves to file
- **Login wall during scrape**: `refreshSession()` → re-login → retry once

In Docker, session file is persisted via named volume (`scraper_sessions:/app/data`).

### Scraping Pipeline (per job)

1. **Navigate** to `instagram.com/{username}/`
2. **Intercept API responses** (passive) — `page.on('response')` captures GraphQL/REST
   calls that Instagram makes during page load → `extractPosts()` gets basic post data
   (shortcode, mediaUrl, caption, mediaType)
3. **Fallback extraction** if no API responses intercepted:
   - Parse embedded JSON from HTML (`<script type="application/json">`)
   - DOM extraction (`a[href*="/p/"]` links + img src)
4. **Enrich via API** (active) — `enrichPostsWithApi()` uses `context.request.get()`
   to call `i.instagram.com/api/v1/feed/user/{id}/`. Gets engagement metrics:
   likesCount, commentsCount, videoViewsCount, videoUrl, carouselMedia, location
5. **Fallback enrichment** — navigates to post page, extracts embedded
   `xdt_api__v1__media__shortcode__web_info` JSON
6. **Store** new posts in MongoDB (dedup by unique index on username+postId)
7. **Deliver** — enqueue deliver jobs for all subscribers of that account

> **Intercept vs Enrich**: interception captures what Instagram sends on page load
> (post structure). Enrichment actively requests the API for engagement metrics that
> aren't included in the page load responses.

### Login Wall Detection

If Instagram redirects to `/accounts/login/`:
1. Close current BrowserContext
2. `refreshSession()` — fresh Playwright login
3. Retry `scrapeProfile()` once (`retry=false` prevents infinite loop)

## Important: Instagram Accounts

**NEVER use the same Instagram account for dev and prod.** Instagram detects concurrent
sessions from different IPs/environments and blocks the account.

- Dev: use a throwaway account in local `.env`
- Prod: use a separate account in prod `.env` on EC2

If an account gets blocked:
1. Change password manually
2. Log in from a real browser, pass any challenge/verification
3. Delete `ig-session.json` (or `docker exec scraper rm /app/data/ig-session.json`)
4. Restart scraper

## Scripts

```bash
# Development
make dev              # Run bot + scraper concurrently
make dev-bot          # Bot (bot + deliver + scheduler)
make dev-scraper      # Scraper worker (Docker)

# Build & Quality
make build            # Build all packages
make lint             # Type-check all packages
make test             # Run all tests

# Docker
make up               # Start infra (MongoDB, Redis, Bull Board, Scraper)
make down             # Stop containers
make redis-cli        # Open Redis CLI
make bull-board       # Open Bull Board in browser
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable              | Description                 | Default                                    |
|-----------------------|-----------------------------|--------------------------------------------|
| `MONGODB_URI`         | MongoDB connection string   | `mongodb://localhost:27019/instagram-scraper` |
| `REDIS_URL`           | Redis connection string     | `redis://localhost:6381`                   |
| `TELEGRAM_BOT_TOKEN`  | Telegram bot API token      | —                                          |
| `INSTAGRAM_USERNAME`  | Instagram login username    | —                                          |
| `INSTAGRAM_PASSWORD`  | Instagram login password    | —                                          |
| `SCRAPE_CONCURRENCY`  | Parallel scrape jobs        | `1`                                        |
| `SCRAPE_TIMEOUT_MS`   | Scrape timeout per job      | `30000`                                    |
| `IG_SESSION_PATH`     | Session file path           | `ig-session.json`                          |

## Tech Stack

- [Grammy](https://grammy.dev/) — Telegram bot framework
- [Playwright](https://playwright.dev/) — browser automation
- [BullMQ](https://bullmq.io/) — job queues
- [Pino](https://getpino.io/) — structured logging
- [MongoDB](https://www.mongodb.com/) — database
- [Redis](https://redis.io/) — queue backend
- [Vitest](https://vitest.dev/) — testing
- [TypeScript](https://www.typescriptlang.org/) — language
