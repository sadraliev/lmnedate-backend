# Project Rules

## Monorepo Structure (pnpm workspaces)

```
packages/shared/    → @app/shared    (queue names, job types, redis config, DB repos)
apps/bot/           → @app/bot       (Grammy Telegram bot, long-polling)
apps/workers/       → @app/workers   (BullMQ deliver + scheduler, single process)
apps/scraper/       → @app/scraper   (Playwright + BullMQ scraper worker, runs in Docker)
tooling/tsconfig/   → @app/tsconfig  (shared TypeScript config)
```

## Commands
- `pnpm dev:bot` — run bot
- `pnpm dev:workers` — run deliver + scheduler workers
- `pnpm dev:scraper` — run scraper worker
- `make dev` — run all 3 concurrently
- `make up` — start infra (MongoDB, Redis, Bull Board, Scraper)
- `pnpm -r lint` — type-check all packages
- `pnpm -r test` — run all tests

## Important
- NEVER use the same Instagram account for dev and prod
- Scraper architecture details are in README.md

## Background Tasks
Before launching ANY background bash task (`run_in_background`):
1. Stop ALL existing background tasks using `TaskStop` for each active task ID
2. Verify zero active tasks remain
3. Only then launch new tasks
4. Never have more than 2 background tasks: 1 bot + 1 scraper
