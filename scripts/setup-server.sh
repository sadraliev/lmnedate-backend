#!/usr/bin/env bash
# Server setup script for EC2 (Ubuntu).
# Run once before the first deploy:
#   scp scripts/setup-server.sh ubuntu@<EC2_HOST>:~
#   ssh ubuntu@<EC2_HOST> 'bash setup-server.sh'
set -euo pipefail

echo "=== 1. System update ==="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "=== 2. Docker ==="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "  Docker installed. Group change requires re-login."
else
  echo "  Docker already installed: $(docker --version)"
fi

echo "=== 3. Docker Compose plugin ==="
if ! docker compose version &>/dev/null; then
  sudo apt-get install -y docker-compose-plugin
else
  echo "  Docker Compose already installed: $(docker compose version)"
fi

echo "=== 4. Node.js 24 (via NodeSource) ==="
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1)" != "v24" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "  Node.js already installed: $(node -v)"
fi

echo "=== 5. PM2 ==="
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
  pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | sudo bash
else
  echo "  PM2 already installed: $(pm2 -v)"
fi

echo "=== 6. Create app directory ==="
mkdir -p ~/app
mkdir -p ~/.scraper

echo "=== 7. .env file ==="
ENV_FILE=~/app/.env
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << 'ENVEOF'
# MongoDB (Docker container, mapped to host port 27019)
MONGODB_URI=mongodb://localhost:27019/fastify-app
MONGODB_DB=fastify-app

# Redis (Docker container, mapped to host port 6381)
REDIS_URL=redis://localhost:6381

# Telegram Bot
TELEGRAM_BOT_TOKEN=

# Instagram Login (use a SEPARATE account from dev!)
INSTAGRAM_USERNAME=
INSTAGRAM_PASSWORD=

# Scraper
SCRAPE_CONCURRENCY=1
SCRAPE_TIMEOUT_MS=30000
IG_SESSION_PATH=~/.scraper/ig-session.json
PLAYWRIGHT_WS=ws://localhost:3000/ws
ENVEOF
  echo "  Created $ENV_FILE — EDIT IT with real values!"
else
  echo "  $ENV_FILE already exists, skipping."
fi

echo ""
echo "=== DONE ==="
echo ""
echo "Next steps:"
echo "  1. Edit ~/app/.env — fill in TELEGRAM_BOT_TOKEN, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD"
echo "  2. Log out and log back in (for Docker group)"
echo "  3. Push to main — GitHub Actions will deploy automatically"
echo ""
