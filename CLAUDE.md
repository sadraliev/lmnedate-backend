# Project Rules

## Monorepo Structure (pnpm workspaces)

```
packages/shared/    → @app/shared  (queue names, job types, redis config, DB repos)
apps/bot/           → @app/bot     (Grammy bot + deliver worker, separate processes)
apps/scheduler/     → @app/scheduler (BullMQ poll scheduler)
apps/scraper/       → @app/scraper (Playwright + BullMQ scraper worker, runs in Docker)
scripts/            → utility scripts
```

## Commands
- `pnpm dev:bot` — run bot
- `pnpm dev:deliver` — run deliver worker
- `pnpm dev:scheduler` — run scheduler
- `pnpm dev:scraper` — run scraper worker
- `make dev` — run all 4 concurrently
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
