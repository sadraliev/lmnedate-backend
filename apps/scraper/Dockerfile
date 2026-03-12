FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/scraper/package.json apps/scraper/
RUN pnpm install --frozen-lockfile --prod
COPY packages/shared/ packages/shared/
COPY apps/scraper/ apps/scraper/
CMD ["pnpm", "--filter", "@app/scraper", "dev"]
