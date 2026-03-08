FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/bot/package.json apps/bot/
RUN pnpm install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY apps/bot/ apps/bot/
CMD ["pnpm", "--filter", "@app/bot", "dev:bot"]
