# One image: the React frontend is built to static files and served by FastAPI.
# Runs as uid 1000 (Hugging Face Spaces requirement). No local inference: every model call goes to
# Nebius Token Factory, so CPU-only hosting is enough.

FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app \
    VOUCH_DATA_DIR=/data \
    PORT=7860
COPY --from=ghcr.io/astral-sh/uv:0.10.10 /uv /usr/local/bin/uv
RUN useradd -m -u 1000 user
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --extra mcp --no-install-project
COPY vouch ./vouch
COPY evals ./evals
COPY --from=web /app/vouch/static ./vouch/static
RUN mkdir -p /data && chown -R user:user /data /app
USER user
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:7860/healthz')"
CMD ["sh", "-c", "uvicorn vouch.api.main:app --host 0.0.0.0 --port ${PORT}"]
