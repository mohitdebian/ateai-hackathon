#!/usr/bin/env sh
set -eu

case "${1:-start}" in
  start)
    [ -f apps/web/.env.local ] || {
      echo "Missing apps/web/.env.local; copy apps/web/.env.example first." >&2
      exit 1
    }
    [ -f apps/worker/.env ] || {
      echo "Missing apps/worker/.env; copy apps/worker/.env.example first." >&2
      exit 1
    }
    supabase start
    docker compose -f compose.local.yml up --build -d --wait worker
    exec pnpm dev
    ;;
  stop)
    docker compose -f compose.local.yml down
    supabase stop
    ;;
  *)
    echo "Usage: $0 [start|stop]" >&2
    exit 64
    ;;
esac
