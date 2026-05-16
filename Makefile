# Crate - Self-hosted music platform
# ==================================

# Remote server
SERVER_HOST   := 95.216.3.27
SERVER_USER   := crate
SERVER_PATH   := /home/crate/crate
SSH           := ssh $(SERVER_USER)@$(SERVER_HOST)

# Compose
DC            := docker compose
DC_LOCAL      := $(DC) -f docker-compose.yaml -f docker-compose.local-stack.yaml
REMOTE_DC     := docker compose -f docker-compose.yaml -f docker-compose.project.yaml

# Local domains
LOCAL_DOMAIN  := crate.local
LOCAL_HOSTS   := traefik auth collection search web api admin

# Colors
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
NC     := \033[0m

.DEFAULT_GOAL := help

# ===========================================================================
# DEV (local development environment)
# ===========================================================================

DC_DEV := $(DC) -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml
DEV_CONTAINERS := crate-dev-api crate-dev-readplane crate-dev-worker crate-dev-maintenance-worker crate-dev-analysis-worker crate-dev-playback-worker crate-dev-postgres crate-dev-redis crate-dev-slskd crate-dev-caddy crate-dev-readplane-proxy

.PHONY: dev
dev: ## Start backend (Postgres + Redis + API + Worker + Readplane + Caddy) and frontend dev servers
	@# Kill any leftover Vite processes from previous runs via PID files
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@sleep 0.5
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend is up (Postgres, Redis, API, Worker, Readplane, Caddy)$(NC)"
	@echo ""
	@echo "Starting frontends..."
	@rm -rf .vite/deps app/ui/node_modules/.vite app/listen/node_modules/.vite node_modules/.vite 2>/dev/null || true
	@mkdir -p .vite
	@npm install --silent 2>/dev/null
	@cd app/docs && npm install --silent 2>/dev/null; cd ../..
	@cd app/site && npm install --silent 2>/dev/null; cd ../..
	@(nohup npm run --workspace=app/ui dev -- --port 5173 --strictPort --host > .vite/admin.log 2>&1 < /dev/null & echo $$! > .vite/admin.pid)
	@(nohup npm run --workspace=app/listen dev -- --port 5174 --strictPort --host > .vite/listen.log 2>&1 < /dev/null & echo $$! > .vite/listen.pid)
	@(nohup npm --prefix app/docs exec vite -- --port 5175 --strictPort --host > .vite/docs.log 2>&1 < /dev/null & echo $$! > .vite/docs.pid)
	@(nohup npm --prefix app/site exec vite -- --port 5176 --strictPort --host > .vite/site.log 2>&1 < /dev/null & echo $$! > .vite/site.pid)
	@sleep 2
	@echo ""
	@echo "  $(GREEN)Admin:$(NC)  https://admin.dev.lespedants.org"
	@echo "  $(GREEN)Listen:$(NC) https://listen.dev.lespedants.org"
	@echo "  $(GREEN)Docs:$(NC)   https://docs.dev.cratemusic.app"
	@echo "  $(GREEN)Site:$(NC)   https://www.dev.cratemusic.app"
	@echo "  $(GREEN)API:$(NC)    https://api.dev.lespedants.org"
	@echo "  $(GREEN)Readplane:$(NC) http://localhost:8686"
	@echo "  Login:  admin@cratemusic.app / admin"
	@echo ""
	@echo "$(GREEN)Everything is running. Use make dev-down to stop it.$(NC)"

.PHONY: dev-back
dev-back: ## Start only the backend (Postgres + Redis + API + Worker + Readplane)
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend is up$(NC)"
	@echo "  API: http://localhost:8585"
	@echo "  Readplane: http://localhost:8686"

.PHONY: dev-admin
dev-admin: ## Start only the Admin UI dev server (:5173)
	@npm run --workspace=app/ui dev -- --port 5173 --host

.PHONY: dev-listen
dev-listen: ## Start only the Listen dev server (:5174)
	@npm run --workspace=app/listen dev -- --port 5174 --host

.PHONY: dev-docs
dev-docs: ## Start only the docs dev server (:5175)
	@cd app/docs && npx vite --port 5175 --host

.PHONY: dev-site
dev-site: ## Start only the site dev server (:5176)
	@cd app/site && npx vite --port 5176 --host

.PHONY: dev-down
dev-down: ## Stop everything (backend + frontends)
	@$(DC_DEV) down
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@echo "$(GREEN)Everything stopped$(NC)"

.PHONY: dev-logs
dev-logs: ## Tail backend logs (usage: make dev-logs or make dev-logs s=worker)
	@if [ -n "$(s)" ]; then \
		$(DC_DEV) logs -f $(s); \
	else \
		$(DC_DEV) logs -f; \
	fi

.PHONY: dev-rebuild
dev-rebuild: ## Rebuild and restart everything
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@sleep 0.5
	@$(DC_DEV) up -d --build --force-recreate
	@rm -rf .vite/deps app/ui/node_modules/.vite app/listen/node_modules/.vite node_modules/.vite 2>/dev/null || true
	@mkdir -p .vite
	@(nohup npm run --workspace=app/ui dev -- --port 5173 --strictPort --host > .vite/admin.log 2>&1 < /dev/null & echo $$! > .vite/admin.pid)
	@(nohup npm run --workspace=app/listen dev -- --port 5174 --strictPort --host > .vite/listen.log 2>&1 < /dev/null & echo $$! > .vite/listen.pid)
	@(nohup npm --prefix app/docs exec vite -- --port 5175 --strictPort --host > .vite/docs.log 2>&1 < /dev/null & echo $$! > .vite/docs.pid)
	@(nohup npm --prefix app/site exec vite -- --port 5176 --strictPort --host > .vite/site.log 2>&1 < /dev/null & echo $$! > .vite/site.pid)
	@sleep 2
	@echo "$(GREEN)Everything rebuilt$(NC)"

.PHONY: dev-reset
dev-reset: ## Reset the dev environment (wipe data and stop everything)
	@$(DC_DEV) down -v
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@echo "$(GREEN)Dev environment reset (data removed)$(NC)"

.PHONY: dev-test
dev-test: dev-test-backend dev-test-readplane dev-test-rust dev-test-frontend ## Run backend, frontend, Go, and Rust checks
	@echo "$(GREEN)All dev checks passed$(NC)"

.PHONY: dev-test-preflight
dev-test-preflight: ## Ensure the dev backend is running before containerized tests
	@missing=0; \
	for svc in postgres redis worker; do \
		if ! $(DC_DEV) ps --services --filter status=running | grep -qx "$$svc"; then \
			echo "$(RED)Missing dev service: $$svc$(NC)"; \
			missing=1; \
		fi; \
	done; \
	if [ "$$missing" -ne 0 ]; then \
		echo "$(YELLOW)Run 'make dev-back' or 'make dev' before make dev-test.$(NC)"; \
		exit 1; \
	fi

DC_TEST := $(DC) -f docker-compose.test.yaml --project-name crate-test

.PHONY: dev-test-backend
dev-test-backend: ## Run Python backend static checks and pytest
	@echo "$(YELLOW)Backend: pyright$(NC)"
	@uv run pyright
	@echo "$(YELLOW)Backend: ruff check$(NC)"
	@uv run ruff check app/crate app/tests
	@echo "$(YELLOW)Backend: ruff format --check$(NC)"
	@uv run ruff format --check app/crate app/tests
	@echo "$(YELLOW)Backend: pytest in an isolated test stack$(NC)"
	@$(DC_DEV) build worker
	@$(DC_TEST) down -v --remove-orphans 2>/dev/null || true
	@$(DC_TEST) up -d --wait
	@docker run --rm --network crate-test_default \
		-v "$(CURDIR)/app:/app" -w /app \
		-e CRATE_POSTGRES_HOST=crate-test-postgres \
		-e CRATE_POSTGRES_PORT=5432 \
		-e CRATE_POSTGRES_USER=crate \
		-e CRATE_POSTGRES_PASSWORD=crate_test \
		-e CRATE_POSTGRES_DB=crate_test \
		-e REDIS_URL=redis://crate-test-redis:6379/0 \
		--entrypoint python \
		musicdock-worker \
		-m pytest tests/ -q --durations=20 \
		--ignore=tests/test_stats_integration.py \
		--ignore=tests/test_user_stats_aggregates.py; \
	EXIT=$$?; \
	$(DC_TEST) down -v --remove-orphans 2>/dev/null || true; \
	exit $$EXIT

.PHONY: dev-test-readplane
dev-test-readplane: ## Run Go readplane tests and vet
	@$(MAKE) readplane-test
	@$(MAKE) readplane-vet

.PHONY: dev-test-rust
dev-test-rust: ## Run Rust tests for native services/tools
	@echo "$(YELLOW)Rust: media-worker$(NC)"
	@cargo test --manifest-path app/media-worker/Cargo.toml
	@echo "$(YELLOW)Rust: crate-cli$(NC)"
	@if [ "$$(uname -s)" = "Linux" ] && [ "$$(uname -m)" = "x86_64" ]; then \
		cargo test --manifest-path tools/crate-cli/Cargo.toml; \
	else \
		echo "$(YELLOW)crate-cli: host has no prebuilt bliss/aubio bindings; testing analysis build$(NC)"; \
		cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis; \
	fi
	@echo "$(YELLOW)Rust: listen desktop Tauri shell$(NC)"
	@cargo test --manifest-path app/listen-desktop/src-tauri/Cargo.toml

.PHONY: dev-test-frontend
dev-test-frontend: ## Run frontend lint, typecheck, tests, and builds
	@echo "$(YELLOW)Frontend: @crate/ui typecheck + build$(NC)"
	@npm run --workspace=app/shared/ui typecheck
	@npm run --workspace=app/shared/ui build
	@echo "$(YELLOW)Frontend: admin lint + typecheck + test + build$(NC)"
	@npm run --workspace=app/ui lint
	@npm run --workspace=app/ui typecheck
	@npm run --workspace=app/ui test
	@npm run --workspace=app/ui build
	@echo "$(YELLOW)Frontend: listen lint + typecheck + test + build$(NC)"
	@npm run --workspace=app/listen lint
	@npm run --workspace=app/listen typecheck
	@npm run --workspace=app/listen test
	@npm run --workspace=app/listen build
	@echo "$(YELLOW)Frontend: desktop typecheck + build$(NC)"
	@npm run --workspace=app/listen-desktop typecheck
	@npm run --workspace=app/listen-desktop build

.PHONY: regression-api
regression-api: ## Critical backend contracts (Explore/search/system playlists)
	@$(DC_DEV) exec worker pytest tests/test_explore_contracts.py tests/test_upload_contracts.py -q

.PHONY: regression-radio
regression-radio: ## Radio contracts using a temporary backend image from the current branch
	@docker build -t crate-radio-tests ./app
	@docker run --rm --entrypoint pytest crate-radio-tests tests/test_radio_contracts.py -q

.PHONY: regression-smoke
regression-smoke: ## Real smoke test against the authenticated dev environment
	@python3 scripts/regression_smoke.py

.PHONY: pg-perf-snapshot
pg-perf-snapshot: ## Read-only PostgreSQL performance snapshot as JSON
	@uv run python scripts/postgres_perf_snapshot.py --pretty

.PHONY: regression-min
regression-min: regression-api regression-smoke ## Minimum regression suite before touching Listen

# ===========================================================================
# CRATE CLI (Rust native toolbox)
# ===========================================================================

.PHONY: crate-cli-linux
crate-cli-linux: ## Build crate-cli for production Linux workers into app/bin/
	@mkdir -p app/bin /tmp/crate-cli-build
	@docker build --platform linux/amd64 --output type=local,dest=/tmp/crate-cli-build tools/crate-cli
	@cp /tmp/crate-cli-build/crate-cli app/bin/crate-cli-linux-amd64
	@chmod +x app/bin/crate-cli-linux-amd64
	@echo "$(GREEN)Built app/bin/crate-cli-linux-amd64$(NC)"

# ===========================================================================
# READPLANE (Go read-only acceleration service)
# ===========================================================================

READPLANE_GO_IMAGE ?= golang:1.23-alpine
READPLANE_GO ?= /usr/local/go/bin/go
READPLANE_FASTAPI_BASE ?= http://host.docker.internal:8585
READPLANE_BASE ?= http://host.docker.internal:8686
READPLANE_AUTH_EMAIL ?= admin@cratemusic.app
READPLANE_AUTH_PASSWORD ?= admin
READPLANE_BENCH_REQUESTS ?= 50
READPLANE_BENCH_WARMUP ?= 5

.PHONY: readplane-test
readplane-test: ## Run readplane Go tests in a container
	@docker run --rm \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) test -cover -coverprofile=coverage.out ./...

.PHONY: readplane-vet
readplane-vet: ## Run go vet for readplane in a container
	@docker run --rm \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) vet ./...

.PHONY: readplane-ci
readplane-ci: readplane-test readplane-vet ## Run readplane local CI checks
	@docker build -t crate-readplane:local app/readplane

.PHONY: readplane-contract-smoke
readplane-contract-smoke: ## Compare readplane P0/P1/P2 responses against local FastAPI
	@docker run --rm \
		--add-host=host.docker.internal:host-gateway \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		-e FASTAPI_BASE="$(READPLANE_FASTAPI_BASE)" \
		-e READPLANE_BASE="$(READPLANE_BASE)" \
		-e READPLANE_CONTRACT_CHECK_P1="$(READPLANE_CONTRACT_CHECK_P1)" \
		-e READPLANE_CONTRACT_P1_QUERY="$(READPLANE_CONTRACT_P1_QUERY)" \
		-e CRATE_AUTH_EMAIL="$(READPLANE_AUTH_EMAIL)" \
		-e CRATE_AUTH_PASSWORD="$(READPLANE_AUTH_PASSWORD)" \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) run ./cmd/readplane-contract-smoke

.PHONY: readplane-benchmark
readplane-benchmark: ## Compare FastAPI vs readplane latency for a P0 route
	@docker run --rm \
		--add-host=host.docker.internal:host-gateway \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		-e FASTAPI_BASE="$(READPLANE_FASTAPI_BASE)" \
		-e READPLANE_BASE="$(READPLANE_BASE)" \
		-e CRATE_AUTH_EMAIL="$(READPLANE_AUTH_EMAIL)" \
		-e CRATE_AUTH_PASSWORD="$(READPLANE_AUTH_PASSWORD)" \
		-e READPLANE_BENCH_REQUESTS="$(READPLANE_BENCH_REQUESTS)" \
		-e READPLANE_BENCH_WARMUP="$(READPLANE_BENCH_WARMUP)" \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) run ./cmd/readplane-benchmark

# ===========================================================================
# LOCAL (full stack with Traefik)
# ===========================================================================

.PHONY: up
up: _check-network ## Start the local stack
	@$(DC_LOCAL) up -d
	@echo "$(GREEN)Local stack is up$(NC)"
	@echo "Dashboard: https://traefik.$(LOCAL_DOMAIN)"

.PHONY: down
down: ## Stop the local stack
	@$(DC_LOCAL) down

.PHONY: restart
restart: down up ## Restart the local stack

.PHONY: logs
logs: ## Tail logs (usage: make logs or make logs s=crate-api)
	@if [ -n "$(s)" ]; then \
		$(DC_LOCAL) logs -f $(s); \
	else \
		$(DC_LOCAL) logs -f; \
	fi

.PHONY: ps
ps: ## Show dev service status
	@$(DC_DEV) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "$(YELLOW)Frontends:$(NC)"
	@-curl -fsS -I http://localhost:5173 >/dev/null 2>&1 && echo "  Admin:  http://localhost:5173 (running)" || echo "  Admin:  not running"
	@-curl -fsS -I http://localhost:5174 >/dev/null 2>&1 && echo "  Listen: http://localhost:5174 (running)" || echo "  Listen: not running"
	@-curl -fsS -I http://localhost:5175 >/dev/null 2>&1 && echo "  Docs:   http://localhost:5175 (running)" || echo "  Docs:   not running"
	@-curl -fsS -I http://localhost:5176 >/dev/null 2>&1 && echo "  Site:   http://localhost:5176 (running)" || echo "  Site:   not running"

.PHONY: pull
pull: ## Pull images for the local stack
	@$(DC_LOCAL) pull
	@echo "$(GREEN)Images updated$(NC)"

.PHONY: shell
shell: ## Open a shell in a service (usage: make shell s=crate-api)
	@if [ -z "$(s)" ]; then echo "$(RED)Specify a service: make shell s=crate-api$(NC)"; exit 1; fi
	@$(DC_LOCAL) exec $(s) sh

# ===========================================================================
# SETUP LOCAL
# ===========================================================================

.PHONY: setup
setup: _check-deps _create-network _generate-certs _setup-hosts _create-dirs ## Initial local environment setup
	@echo "$(GREEN)Setup complete. Run 'make up' to start the stack$(NC)"

.PHONY: _check-deps
_check-deps:
	@command -v docker >/dev/null 2>&1 || { echo "$(RED)Docker is not installed$(NC)"; exit 1; }
	@command -v mkcert >/dev/null 2>&1 || { echo "$(YELLOW)Installing mkcert...$(NC)"; brew install mkcert; }
	@mkcert -install 2>/dev/null || true

.PHONY: _create-network
_create-network:
	@docker network inspect crate >/dev/null 2>&1 || docker network create crate
	@echo "$(GREEN)crate network ready$(NC)"

.PHONY: _check-network
_check-network:
	@docker network inspect crate >/dev/null 2>&1 || { echo "$(RED)The crate network does not exist. Run 'make setup'$(NC)"; exit 1; }

.PHONY: _generate-certs
_generate-certs:
	@echo "$(YELLOW)Generating local TLS certificates...$(NC)"
	@cd data/traefik/local/certs && mkcert \
		"$(LOCAL_DOMAIN)" \
		"*.$(LOCAL_DOMAIN)" \
		&& mv $(LOCAL_DOMAIN)+1.pem $(LOCAL_DOMAIN).pem \
		&& mv $(LOCAL_DOMAIN)+1-key.pem $(LOCAL_DOMAIN)-key.pem
	@echo "$(GREEN)Certificates generated$(NC)"

.PHONY: _setup-hosts
_setup-hosts:
	@echo "$(YELLOW)Configuring /etc/hosts (requires sudo)...$(NC)"
	@for host in $(LOCAL_HOSTS); do \
		if ! grep -q "$$host.$(LOCAL_DOMAIN)" /etc/hosts; then \
			echo "127.0.0.1 $$host.$(LOCAL_DOMAIN)" | sudo tee -a /etc/hosts >/dev/null; \
		fi; \
	done
	@echo "$(GREEN)/etc/hosts configured$(NC)"

.PHONY: _create-dirs
_create-dirs:
	@mkdir -p data/{traefik/local/certs,tidarr,tidalrr,slskd,soulsync/{config,logs},nginx/{html,conf.d,logs}}
	@mkdir -p media/{music,downloads/{tidal/{incomplete,albums,tracks,playlists,videos},soulseek/incomplete}}
	@echo "$(GREEN)Directories created$(NC)"

# ===========================================================================
# DEPLOY (production)
# ===========================================================================

# Defaults to the short SHA tag published by GitHub Actions for origin/main.
# Overrides: DEPLOY_IMAGE_TAG=<tag>, DEPLOY_REF=<git-ref>, DEPLOY_IMAGE_OWNER=<owner>, DEPLOY_PUBLIC_CHECKS=0.
.PHONY: deploy
deploy: ## Deploy origin/main GHCR images by SHA, verify health, rollback on failure
	@SERVER_USER="$(SERVER_USER)" SERVER_HOST="$(SERVER_HOST)" SERVER_PATH="$(SERVER_PATH)" DEPLOY_IMAGE_OWNER="$(DEPLOY_IMAGE_OWNER)" DEPLOY_IMAGE_REGISTRY="$(DEPLOY_IMAGE_REGISTRY)" scripts/deploy.sh

.PHONY: deploy-build
deploy-build: ## Deploy by building on the server (GHCR fallback)
	@echo "$(YELLOW)Syncing files...$(NC)"
	@scp docker-compose.yaml docker-compose.project.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az --delete \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/
	@# crate-docs Dockerfile uses the repo root as build context and needs
	@# the top-level docs/ directory for the markdown files embedded at
	@# build time. Without this the build fails on COPY docs/ /docs/.
	@rsync -az --delete docs/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/docs/
	@echo "$(YELLOW)Building services on the server...$(NC)"
	@# Build every buildable service in the canonical project stack,
	@# including the project overlay that defines crate-site + crate-docs.
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) build"
	@echo "$(YELLOW)Pulling external images...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) pull --ignore-buildable"
	@echo "$(YELLOW)Restarting services...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) up -d"
	@echo "$(GREEN)Deploy complete$(NC)"

.PHONY: deploy-sync
deploy-sync: ## Sync files to the server without restarting services
	@scp docker-compose.yaml docker-compose.project.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az --delete \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/
	@rsync -az --delete docs/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/docs/

.PHONY: deploy-restart
deploy-restart: ## Restart remote services without syncing files
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) up -d"

.PHONY: deploy-pull
deploy-pull: ## Pull images on the remote server
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) pull --ignore-buildable"

.PHONY: deploy-logs
deploy-logs: ## Tail remote logs (usage: make deploy-logs s=crate-api)
	@if [ -n "$(s)" ]; then \
		$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) logs -f --tail=100 $(s)"; \
	else \
		$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) logs -f --tail=100"; \
	fi

.PHONY: deploy-ps
deploy-ps: ## Show remote service status
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) ps --format 'table {{.Name}}\t{{.Status}}'"

.PHONY: deploy-shell
deploy-shell: ## Open a remote shell in a service (usage: make deploy-shell s=crate-api)
	@if [ -z "$(s)" ]; then echo "$(RED)Specify a service: make deploy-shell s=crate-api$(NC)"; exit 1; fi
	@$(SSH) -t "cd $(SERVER_PATH) && $(REMOTE_DC) exec $(s) sh"

.PHONY: deploy-ssh
deploy-ssh: ## Open an SSH session to the server
	@$(SSH)

# ===========================================================================
# UTILIDADES
# ===========================================================================

.PHONY: lib-scan
lib-scan: ## Scan the music library for issues
	@$(DC_LOCAL) run --rm crate-worker scan

.PHONY: lib-fix
lib-fix: ## Run fixers in dry-run mode
	@$(DC_LOCAL) run --rm crate-worker fix --dry-run

.PHONY: lib-fix-apply
lib-fix-apply: ## Apply fixer changes to the library
	@echo "$(RED)WARNING: This will modify files in the music library$(NC)"
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Cancelled"; exit 1; }
	@$(DC_LOCAL) run --rm crate-worker fix --apply

.PHONY: lib-report
lib-report: ## Generate a library health report
	@$(DC_LOCAL) run --rm crate-worker report

.PHONY: lib-build-ui
lib-build-ui: ## Build the admin UI image
	@$(DC_LOCAL) build crate-ui
	@echo "$(GREEN)Admin UI image built$(NC)"

.PHONY: clean
clean: ## Stop the local stack and clean up orphaned resources
	@$(DC_LOCAL) down --remove-orphans
	@echo "$(GREEN)Cleanup complete$(NC)"

.PHONY: nuke
nuke: ## Stop the local stack and remove containers, volumes, and orphaned resources (DESTRUCTIVE)
	@echo "$(RED)WARNING: This will remove containers and volumes$(NC)"
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Cancelled"; exit 1; }
	@$(DC_LOCAL) down -v --remove-orphans

.PHONY: update
update: pull up ## Pull images and restart the local stack

.PHONY: hosts-show
hosts-show: ## Show configured local domains
	@echo "$(GREEN)Local domains:$(NC)"
	@for host in $(LOCAL_HOSTS); do \
		echo "  https://$$host.$(LOCAL_DOMAIN)"; \
	done

# ===========================================================================
# LOCAL DNS (*.crate.local wildcard)
# ===========================================================================

.PHONY: dns-setup
dns-setup: ## Setup local DNS wildcard for *.crate.local → 127.0.0.1 (requires sudo)
	@./scripts/setup-local-dns.sh

.PHONY: trust-local-ca
trust-local-ca: ## Trust Caddy's local CA for HTTPS (run after first 'make dev', requires sudo)
	@docker cp crate-dev-caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt
	@sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt
	@echo "$(GREEN)Caddy local CA trusted. Restart your browser.$(NC)"

# ===========================================================================
# CAPACITOR (mobile native builds)
# ===========================================================================

CAP_DIR := app/listen
CAP_IOS_TARGET ?= $(shell cd $(CAP_DIR) && npx cap run ios --list 2>/dev/null | grep "iPhone.*Pro " | head -1 | awk '{print $$NF}')
CAP_DEBUG_SERVER_URL ?= https://listen.lespedants.org

# Android Studio JBR + SDK paths (required for Gradle/emulator)
export JAVA_HOME ?= $(HOME)/Applications/Android Studio.app/Contents/jbr/Contents/Home
export ANDROID_HOME ?= $(HOME)/Library/Android/sdk

.PHONY: cap-build
cap-build: ## Build Listen for Capacitor (bakes production API URL)
	@cd $(CAP_DIR) && npm run build:cap
	@echo "$(GREEN)Capacitor build + sync done$(NC)"

.PHONY: cap-ios
cap-ios: ## Build and run Listen on iOS Simulator
	@cd $(CAP_DIR) && VITE_API_URL="$(CAP_DEBUG_SERVER_URL)" npm run build:cap
	@echo "$(YELLOW)Launching iOS Simulator...$(NC)"
	@cd $(CAP_DIR) && npx cap run ios --target "$(CAP_IOS_TARGET)"

.PHONY: cap-ios-open
cap-ios-open: ## Open Listen iOS project in Xcode
	@cd $(CAP_DIR) && npx cap open ios

.PHONY: cap-android
cap-android: ## Build and run Listen on Android Emulator
	@cd $(CAP_DIR) && VITE_API_URL="$(CAP_DEBUG_SERVER_URL)" npm run build:cap
	@echo "$(YELLOW)Launching Android Emulator...$(NC)"
	@cd $(CAP_DIR) && npx cap run android

.PHONY: cap-android-open
cap-android-open: ## Open Listen Android project in Android Studio
	@cd $(CAP_DIR) && npx cap open android

.PHONY: cap-ios-list
cap-ios-list: ## List available iOS Simulator targets
	@cd $(CAP_DIR) && npx cap run ios --list

.PHONY: cap-android-list
cap-android-list: ## List available Android Emulator targets
	@cd $(CAP_DIR) && npx cap run android --list

# ===========================================================================
# TAURI (desktop native builds)
# ===========================================================================

TAURI_DIR := app/listen-desktop

.PHONY: tauri-dev
tauri-dev: ## Build and run Crate desktop with Tauri dev mode
	@cd $(TAURI_DIR) && npm run tauri:dev

.PHONY: tauri-build-app
tauri-build-app: ## Build Crate desktop macOS .app bundle
	@cd $(TAURI_DIR) && npm run tauri:build:app

.PHONY: tauri-build
tauri-build: ## Build Crate desktop local app bundle
	@cd $(TAURI_DIR) && npm run tauri:build

.PHONY: tauri-build-all
tauri-build-all: ## Build Crate desktop all release bundles
	@cd $(TAURI_DIR) && npm run tauri:build:all

.PHONY: tauri-collect-artifacts
tauri-collect-artifacts: ## Collect Crate desktop release artifacts into desktop-artifacts/
	@$(TAURI_DIR)/scripts/collect-artifacts.sh local

# ===========================================================================
# HELP
# ===========================================================================

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "$(GREEN)Crate$(NC) - Self-hosted music platform"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "Example: $(YELLOW)make logs s=crate-api$(NC)"
	@echo ""
