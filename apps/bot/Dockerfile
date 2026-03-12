# ── Build ──
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Compile shared → dist/, patch main for prod resolution, compile app
RUN pnpm --filter @app/shared build \
    && sed -i 's|"./src/index.ts"|"./dist/index.js"|' packages/shared/package.json \
    && pnpm --filter @app/bot build
# Flat deploy with prod deps only (no tsx, no devDeps)
RUN pnpm --filter @app/bot --prod deploy /prod/bot

# ── Production ──
FROM node:24-alpine
WORKDIR /app
COPY --from=build /prod/bot .
CMD ["node", "dist/bot.js"]
