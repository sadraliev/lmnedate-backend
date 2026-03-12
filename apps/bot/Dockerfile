FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/bot/package.json apps/bot/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod
COPY packages/shared/ packages/shared/
COPY apps/bot/ apps/bot/
CMD ["node", "--import", "tsx", "apps/bot/src/main.ts"]
