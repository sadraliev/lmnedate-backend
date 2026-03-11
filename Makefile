.PHONY: help install dev dev-web dev-bot dev-deliver dev-scraper build lint test up down docker-logs redis-cli bull-board clean

.DEFAULT_GOAL := help

BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
NC := \033[0m

help: ## Display this help message
	@echo "$(BLUE)Development Commands$(NC)"
	@echo ""
	@echo "Usage: make $(GREEN)<target>$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-18s$(NC) %s\n", $$1, $$2}'

# Setup
install: ## Install all workspace dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	@pnpm install

setup: install ## Initial setup (install + create .env)
	@if [ ! -f .env ]; then \
		echo "$(BLUE)Creating .env file...$(NC)"; \
		cp .env.example .env; \
		echo "$(YELLOW)Please update .env with your configuration$(NC)"; \
	else \
		echo "$(GREEN).env file already exists$(NC)"; \
	fi

# Development
dev: ## Run all services concurrently
	@pnpm exec concurrently -n bot,deliver,scraper,api -c blue,magenta,cyan,green \
		"pnpm dev:bot" "pnpm dev:deliver" "pnpm dev:scraper" "pnpm dev:api"

dev-api: ## Run API server (Fastify)
	@pnpm dev:api

dev-bot: ## Run Telegram bot
	@pnpm dev:bot

dev-deliver: ## Run deliver worker
	@pnpm dev:deliver

dev-scraper: ## Run scraper worker
	@pnpm dev:scraper

build: ## Build all packages
	@pnpm build

lint: ## Type-check all packages
	@pnpm lint

test: ## Run all tests
	@pnpm test

# Docker
up: ## Start all containers
	@echo "$(BLUE)Starting Docker containers...$(NC)"
	@docker-compose up -d
	@echo "$(GREEN)Redis running on port 6381$(NC)"
	@echo "$(GREEN)Bull Board running on port 3333$(NC)"

up-redis: ## Start Redis container
	@docker-compose up -d redis

up-board: ## Start Bull Board container
	@docker-compose up -d bull-board

down: ## Stop and remove containers
	@docker-compose down -v

docker-logs: ## View all container logs
	@docker-compose logs -f

redis-cli: ## Open Redis CLI
	@docker exec -it fastify-app-redis redis-cli

redis-status: ## Check Redis connection
	@docker exec fastify-app-redis redis-cli ping

bull-board: ## Open Bull Board in browser
	@open http://localhost:3333 2>/dev/null || echo "Open http://localhost:3333"

# Cleanup
clean: ## Remove build artifacts
	@rm -rf packages/*/dist apps/*/dist
	@echo "$(GREEN)Clean complete$(NC)"

clean-all: clean ## Remove all node_modules
	@rm -rf node_modules packages/*/node_modules apps/*/node_modules
	@echo "$(GREEN)All clean$(NC)"
