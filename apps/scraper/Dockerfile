FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @app/scraper --prod deploy /prod/scraper

FROM node:24-slim
WORKDIR /app
COPY --from=build /prod/scraper .
RUN npx playwright install --with-deps chromium
CMD ["node", "--import", "tsx", "src/worker.ts"]
