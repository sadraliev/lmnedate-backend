# Playwright browser server — heavy image, rebuild only on Playwright version change.
# Exposes Chromium via WebSocket for the scraper app to connect to.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm init -y && npm install playwright@1.58.2

COPY apps/scraper/server.js server.js

EXPOSE 3000
CMD ["node", "server.js"]
