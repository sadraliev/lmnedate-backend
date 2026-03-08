# Project Rules

## Monorepo Structure (pnpm workspaces)

```
packages/shared/    → @app/shared  (queue names, job types, redis config)
apps/bot/           → @app/bot     (Grammy bot + deliver worker)
apps/scraper/       → @app/scraper (Playwright + BullMQ scraper)
apps/web/           → @app/web     (Fastify dashboard + API)
scripts/            → utility scripts
```

## Commands
- `pnpm dev:bot` / `pnpm dev:deliver` / `pnpm dev:scraper` / `pnpm dev:web`
- `pnpm -r lint` — type-check all packages
- `pnpm -r test` — run all tests
- `make up` / `make down` — Docker

## Background Tasks
Before launching ANY background bash task (`run_in_background`):
1. Stop ALL existing background tasks using `TaskStop` for each active task ID
2. Verify zero active tasks remain
3. Only then launch new tasks
4. Never have more than 2 background tasks: 1 bot + 1 scraper
