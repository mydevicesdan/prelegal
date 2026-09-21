# Stage 1: build the static frontend.
# The layout mirrors the repo (/frontend next to /templates) because the frontend
# reads ../templates at build time.
FROM node:24-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY templates/ /templates/
RUN npm run build

# Stage 2: FastAPI serving the API and the static frontend.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
# The backend parses the templates at runtime; catalog.json must sit next to the templates directory.
COPY templates/ ./templates/
COPY catalog.json ./catalog.json
COPY --from=frontend /frontend/out ./static

ENV PATH="/app/.venv/bin:$PATH" \
    PRELEGAL_STATIC_DIR=/app/static \
    PRELEGAL_TEMPLATES_DIR=/app/templates \
    PRELEGAL_DB_PATH=/tmp/prelegal.db
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
