#!/usr/bin/env bash
# Project Foundation Console — installer (bash / git-bash / wsl / macos / linux)
set -e

echo ">> PFC installer"

if ! command -v node >/dev/null 2>&1; then
  echo "!! Node.js not found. Install Node 18+ first: https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "!! Node 18+ required (current: $(node -v))"; exit 1
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo ">> Created .env from .env.example — edit VITE_SL_DATA_API_*"
fi

echo ">> Installing dependencies (pnpm/npm/yarn auto-detected)"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
elif [ -f pnpm-lock.yaml ]; then
  corepack enable && pnpm install
elif command -v yarn >/dev/null 2>&1; then
  yarn install
else
  npm install
fi

echo ">> Done. Run:  pnpm dev   |   npm run dev   |   yarn dev"
