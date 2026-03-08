.PHONY: help install dev build start lint clean docker-up docker-down docker-restart docker-logs db-shell redis-cli test setup all bull-board up-scraper logs-scraper

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
NC := \033[0m # No Color

help: ## Display this help message
	@echo "$(BLUE)Development Commands$(NC)"
	@echo ""
	@echo "Usage: make $(GREEN)<target>$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-18s$(NC) %s\n", $$1, $$2}'

# Setup
install: ## Install dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	@npm install

setup: install ## Initial setup (install + create .env)
	@if [ ! -f .env ]; then \
		echo "$(BLUE)Creating .env file...$(NC)"; \
		cp .env.example .env; \
		echo "$(YELLOW)⚠️  Please update .env with your configuration$(NC)"; \
	else \
		echo "$(GREEN).env file already exists$(NC)"; \
	fi

# Development
dev: ## Run development server with hot reload
	@echo "$(BLUE)Starting development server...$(NC)"
	@npm run dev

build: ## Build TypeScript to JavaScript
	@echo "$(BLUE)Building application...$(NC)"
	@npm run build

start: ## Run built application
	@echo "$(BLUE)Starting production server...$(NC)"
	@npm start

lint: ## Type-check TypeScript
	@echo "$(BLUE)Type-checking...$(NC)"
	@npm run lint

jobs: ## Run jobs server with hot reload
	@echo "$(BLUE)Starting jobs server...$(NC)"
	@npm run jobs
# Docker
up: ## Start all containers (MongoDB, Redis, Bull Board, Scraper)
	@echo "$(BLUE)Starting Docker containers...$(NC)"
	@docker-compose up -d
	@echo "$(GREEN)✓ MongoDB running on port 27019$(NC)"
	@echo "$(GREEN)✓ Redis running on port 6381$(NC)"
	@echo "$(GREEN)✓ Bull Board running on port 3333$(NC)"
	@echo "$(GREEN)✓ Instagram scraper running$(NC)"

up-scraper: ## Start Instagram scraper (dev mode with hot reload)
	@echo "$(BLUE)Starting Instagram scraper (dev)...$(NC)"
	@docker-compose up -d --build instagram-scraper
	@echo "$(GREEN)✓ Instagram scraper running (hot reload via tsx --watch)$(NC)"

logs-scraper: ## View Instagram scraper logs
	@docker-compose logs -f instagram-scraper

up-board: ## Start Bull Board container
	@echo "$(BLUE)Starting Bull Board...$(NC)"
	@docker-compose up -d bull-board
	@echo "$(GREEN)✓ Bull Board running on port 3333$(NC)"
up-redis: ## Start Redis container
	@echo "$(BLUE)Starting Redis...$(NC)"
	@docker-compose up -d redis
	@echo "$(GREEN)✓ Redis running on port 6381$(NC)"
up-mongodb: ## Start MongoDB container
	@echo "$(BLUE)Starting MongoDB...$(NC)"
	@docker-compose up -d mongodb
	@echo "$(GREEN)✓ MongoDB running on port 27019$(NC)"
down: ## Stop and remove containers
	@echo "$(BLUE)Stopping Docker containers...$(NC)"
	@docker-compose down -v

docker-restart: ## Restart containers
	@echo "$(BLUE)Restarting Docker containers...$(NC)"
	@docker-compose restart

docker-logs: ## View all container logs
	@docker-compose logs -f

docker-logs-mongo: ## View MongoDB logs
	@docker-compose logs -f mongodb

docker-logs-redis: ## View Redis logs
	@docker-compose logs -f redis

docker-logs-bull-board: ## View Bull Board logs
	@docker-compose logs -f bull-board

docker-clean: ## Stop containers and remove volumes (DANGEROUS)
	@echo "$(YELLOW)⚠️  This will remove all data in MongoDB and Redis$(NC)"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker-compose down -v; \
		echo "$(GREEN)✓ Containers and volumes removed$(NC)"; \
	fi

# Database
db-shell: ## Open MongoDB shell
	@echo "$(BLUE)Opening MongoDB shell...$(NC)"
	@docker exec -it fastify-app-mongodb mongosh fastify-app

db-status: ## Check MongoDB connection
	@echo "$(BLUE)Checking MongoDB status...$(NC)"
	@docker exec fastify-app-mongodb mongosh --quiet --eval "db.adminCommand('ping')" && \
		echo "$(GREEN)✓ MongoDB is running$(NC)" || \
		echo "$(YELLOW)✗ MongoDB is not responding$(NC)"

redis-cli: ## Open Redis CLI
	@echo "$(BLUE)Opening Redis CLI...$(NC)"
	@docker exec -it fastify-app-redis redis-cli

redis-status: ## Check Redis connection
	@echo "$(BLUE)Checking Redis status...$(NC)"
	@docker exec fastify-app-redis redis-cli ping && \
		echo "$(GREEN)✓ Redis is running$(NC)" || \
		echo "$(YELLOW)✗ Redis is not responding$(NC)"

bull-board: ## Open Bull Board in browser (or show URL)
	@echo "$(BLUE)Bull Board is available at:$(NC)"
	@echo "$(GREEN)http://localhost:3333$(NC)"
	@echo ""
	@echo "$(BLUE)Opening in browser...$(NC)"
	@open http://localhost:3333 2>/dev/null || \
		xdg-open http://localhost:3333 2>/dev/null || \
		echo "$(YELLOW)Please open http://localhost:3333 in your browser$(NC)"

# Cleanup
clean: ## Remove build artifacts
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	@rm -rf dist/
	@rm -rf node_modules/.cache/
	@echo "$(GREEN)✓ Clean complete$(NC)"

clean-all: clean ## Remove all generated files and dependencies
	@echo "$(BLUE)Removing node_modules...$(NC)"
	@rm -rf node_modules/
	@echo "$(GREEN)✓ All clean$(NC)"

# Quick Start
all: setup docker-up ## Full setup and start (install, docker-up)
	@echo ""
	@echo "$(GREEN)✓ Setup complete!$(NC)"
	@echo ""
	@echo "$(BLUE)Next steps:$(NC)"
	@echo "  1. Update .env if needed"
	@echo "  2. Run: $(GREEN)make dev$(NC)"

test: ## Run tests
	@npm test
