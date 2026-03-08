FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# Install dependencies (all, including devDependencies for tsx in dev mode)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Production entry point (overridden in dev via docker-compose)
CMD ["node", "dist/scraper-worker.js"]
