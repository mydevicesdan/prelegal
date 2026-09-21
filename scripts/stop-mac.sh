#!/usr/bin/env bash
# Stop and remove the Prelegal container (its temporary database goes with it).
set -euo pipefail

docker rm -f prelegal >/dev/null 2>&1 || true
echo "Prelegal stopped"
