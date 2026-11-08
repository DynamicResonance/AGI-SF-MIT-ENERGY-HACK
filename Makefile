# Midday Surplus -> Tokens
#   make up        one command: build + run both services in Docker (http://localhost:3000)
#   make dev       run locally without Docker (backend :8000, frontend :3000)
#   make test      backend (pytest) + frontend (vitest) tests
-include .env
export

.PHONY: install dev up down test snapshots prewarm record-agent-run

install:
	cd backend && pip install -r requirements-dev.txt
	cd frontend && npm ci

dev:
	@trap 'kill 0' INT TERM; \
	(cd backend && uvicorn app.main:app --port 8000 --reload) & \
	(cd frontend && BACKEND_URL=http://localhost:8000 npm run dev -- -p 3000) & \
	wait

up:
	docker compose up --build

down:
	docker compose down

test:
	cd backend && python -m pytest -q tests
	cd frontend && npm test

# Rebuild bundled offline snapshots (365 days ending at each region's default date).
snapshots:
	python scripts/make_snapshots.py

# Warm the backend cache for the demo days (run before going on stage).
prewarm:
	python scripts/prewarm.py

# Record real agent-loop runs (needs ANTHROPIC_API_KEY) for offline replay on stage.
record-agent-run:
	python scripts/record_agent_run.py CAISO ERCOT
