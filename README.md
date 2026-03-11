# Postergeist

Instagram scraper with Telegram delivery. Monitors public profiles, extracts posts via Playwright, and delivers them to Telegram chats through BullMQ job queues.

## Features

- **Telegram bot** — `/update <username>` triggers scraping and delivers the latest post
- **Instagram scraper** — Playwright-based with session management, login wall detection, and DOM/API fallbacks
- **Post enrichment** — engagement data (likes, comments, views) via mobile feed API + page navigation fallback
- **Job queues** — BullMQ for scrape and deliver pipelines with retry/backoff
- **REST API** — Fastify dashboard with auth, Swagger docs, rate limiting
- **Structured logging** — centralized pino logger with JSON in production, pretty-printed in dev, and daily-rotated log files
- **Testing** — unit tests (Vitest) and E2E tests

## Quick Start

```bash
# Install dependencies
pnpm install

# Start infrastructure (Redis, Bull Board)
make up

# Copy and configure environment
cp .env.example .env

# Run all services
make dev

# Or individually in separate terminals
make dev-bot        # Telegram bot
make dev-deliver    # Deliver worker
make dev-scraper    # Scraper worker
make dev-api        # API server
```

## Project Structure

```
packages/shared/              # @app/shared — zero-dep shared library
├── src/
│   ├── logger.ts             # createLogger factory (pino)
│   ├── redis.ts              # Redis connection with retry
│   ├── queue-names.ts        # BullMQ queue name constants
│   ├── job-types.ts          # ScrapeJobData, DeliverJobData
│   ├── post-types.ts         # ScrapedPost, CarouselMediaItem
│   ├── parser.ts             # Instagram JSON/HTML post extraction
│   └── caption-utils.ts      # Hashtag/mention extraction

apps/bot/                     # @app/bot — Telegram bot + deliver worker
├── src/
│   ├── bot.ts                # Grammy long-polling (/start, /update)
│   ├── deliver.ts            # BullMQ consumer → Telegram messages
│   └── bot-instance.ts       # Shared Grammy bot instance

apps/scraper/                 # @app/scraper — Playwright scraper
├── src/
│   ├── worker.ts             # BullMQ consumer, job processing
│   ├── scrape.ts             # Browser lifecycle, profile scraping, enrichment
│   ├── session.ts            # Instagram login + Redis session persistence
│   └── parser.ts             # Post extraction (re-exports from shared)

apps/api/                     # @app/api — Fastify REST API
├── src/
│   ├── server.ts             # Fastify app factory
│   ├── modules/auth/         # Auth module (register, login, JWT, password reset)
│   ├── modules/telegram/     # Telegram module (bot management)
│   └── config/               # Environment, logger, Redis config

scripts/                      # Utility scripts (not production code)
```

## Scripts

```bash
# Development
make dev              # Run all services concurrently
make dev-api          # API server with hot reload
make dev-bot          # Telegram bot
make dev-deliver      # Deliver worker
make dev-scraper      # Scraper worker

# Build & Quality
make build            # Build all packages
make lint             # Type-check all packages
make test             # Run all tests

# Docker
make up               # Start Redis + Bull Board
make down             # Stop containers
make redis-cli        # Open Redis CLI
make bull-board       # Open Bull Board in browser
```

## Testing

```bash
pnpm -r test              # All tests
pnpm -r lint              # Type-check all packages
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable              | Description                 | Default                        |
|-----------------------|-----------------------------|--------------------------------|
| `PORT`                | API server port             | `3000`                         |
| `NODE_ENV`            | Environment                 | `development`                  |
| `JWT_SECRET`          | JWT signing secret (32+)    | —                              |
| `MONGODB_URI`         | MongoDB connection string   | `mongodb://localhost:27019/fastify-app` |
| `REDIS_URL`           | Redis connection string     | `redis://localhost:6381`       |
| `TELEGRAM_BOT_TOKEN`  | Telegram bot API token      | —                              |
| `INSTAGRAM_USERNAME`  | Instagram login username    | —                              |
| `INSTAGRAM_PASSWORD`  | Instagram login password    | —                              |
| `LOG_LEVEL`           | Log level override          | `debug` (dev), `info` (prod)   |

## Logging

All apps use a shared pino logger from `@app/shared`:

```typescript
import { createLogger } from '@app/shared';

const logger = createLogger({ name: 'my-service' });
logger.info({ userId: 123 }, 'User logged in');
```

**Dev mode** — pretty-printed to stdout + daily-rotated JSON files in `logs/`:

```
logs/
├── bot.2026-03-11.1.log
├── scraper.2026-03-11.1.log
├── deliver.2026-03-11.1.log
└── api.2026-03-11.1.log
```

- Files rotate daily, 7-day retention
- `logs/` is gitignored

**Production** — JSON to stdout only (consumed by Docker/CloudWatch/etc.)

Override the log level with `LOG_LEVEL`:

```bash
LOG_LEVEL=warn pnpm dev:bot
```

## Tech Stack

- [Fastify](https://fastify.dev/) — web framework
- [Grammy](https://grammy.dev/) — Telegram bot framework
- [Playwright](https://playwright.dev/) — browser automation
- [BullMQ](https://bullmq.io/) — job queues
- [Pino](https://getpino.io/) — structured logging
- [MongoDB](https://www.mongodb.com/) — database
- [Redis](https://redis.io/) — session storage + queue backend
- [Zod](https://zod.dev/) — schema validation
- [Vitest](https://vitest.dev/) — testing
- [TypeScript](https://www.typescriptlang.org/) — language

## License

ISC
