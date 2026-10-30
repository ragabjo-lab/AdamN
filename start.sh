#!/usr/bin/env bash
# AdamN NMS launcher (macOS / Linux)
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (>= 22.13). Download it from https://nodejs.org"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies for the first time..."
  npm install --no-audit --no-fund
fi
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4000}"
export ADAMN_OPEN="${ADAMN_OPEN:-1}"
exec npm start
