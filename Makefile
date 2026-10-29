# Vouch — common tasks. Windows users: run these from Git Bash, or copy the commands.
PY := uv run
PORT ?= 7860

.PHONY: install dev api web test lint check-secrets eval eval-mock lme demo-seed smoke docker up deploy-hf video

install:            ## Python + frontend dependencies
	uv sync --extra mcp
	cd web && npm ci

dev:                ## API on :7860 with hot reload + Vite dev server on :5173
	$(PY) uvicorn vouch.api.main:app --reload --port $(PORT) & cd web && npm run dev

api:                ## API only (serves the built frontend from vouch/static if present)
	$(PY) uvicorn vouch.api.main:app --port $(PORT)

web:                ## Build the frontend into vouch/static
	cd web && npm run build

test:               ## Unit + integration tests (deterministic mock models, no API keys)
	VOUCH_PROVIDER=mock $(PY) pytest -q

lint:
	$(PY) ruff check .
	cd web && npm run typecheck

check-secrets:      ## Fail if anything that looks like an API key is tracked in git
	$(PY) python scripts/check_secrets.py

eval:               ## Full eval on Nebius Token Factory -> evals/results/latest.{json,md}
	VOUCH_PROVIDER=tokenfactory $(PY) python -m evals.run --config all --runs 3 --lme 100

eval-mock:          ## Pipeline smoke test of the harness -> evals/results/mock/
	VOUCH_PROVIDER=mock $(PY) python -m evals.run --config all --runs 1

lme:                ## LongMemEval_s utility only
	$(PY) python -m evals.longmemeval.run_lme --n 100

demo-seed:          ## Create a seeded local workspace (persona Asha) under data/sessions/local-user
	VOUCH_LOCAL_SESSION=local-user $(PY) python -c "from vouch.mcp_server.server import workspace; import os; os.environ['VOUCH_MCP_SEED']='asha'; ws=workspace(); ws.is_seeded() or ws.seed(); print('seeded', ws.root)"

smoke:              ## Invoice-CC scenario against a running deployment: make smoke URL=https://...
	$(PY) python scripts/smoke.py --url $(or $(URL),http://localhost:$(PORT))

docker:
	docker build -t vouch:latest .

up:                 ## docker compose up (needs .env)
	docker compose up --build

deploy-hf:          ## Push to a Hugging Face Space: make deploy-hf SPACE=user/vouch
	bash scripts/deploy_hf.sh $(SPACE)

video:              ## Record demo clips with Playwright against URL (default local)
	cd video && npm install && npx playwright install chromium && BASE_URL=$(or $(URL),http://localhost:$(PORT)) node record.mjs
