FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/scheduler/package.json apps/scheduler/
RUN pnpm install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY apps/scheduler/ apps/scheduler/
CMD ["pnpm", "--filter", "@app/scheduler", "dev"]
