#!/usr/bin/env bash
# Build and start Prelegal at http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")/.."

docker rm -f prelegal >/dev/null 2>&1 || true
docker build -t prelegal .

env_args=()
[ -f .env ] && env_args=(--env-file .env)
docker run -d --name prelegal -p 8000:8000 ${env_args[@]+"${env_args[@]}"} prelegal

echo "Prelegal is running at http://localhost:8000"
