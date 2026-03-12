FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tooling/tsconfig/package.json tooling/tsconfig/
COPY packages/shared/package.json packages/shared/
COPY apps/workers/package.json apps/workers/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod
COPY tooling/tsconfig/ tooling/tsconfig/
COPY packages/shared/ packages/shared/
COPY apps/workers/ apps/workers/
CMD ["node", "--import", "tsx", "apps/workers/src/main.ts"]
