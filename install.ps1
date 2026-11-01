# Project Foundation Console — installer (Windows PowerShell)
$ErrorActionPreference = 'Stop'
Write-Host ">> PFC installer"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "!! Node.js not found. Install Node 18+: https://nodejs.org"; exit 1
}
$v = [int]((node -p "process.versions.node.split('.')[0]"))
if ($v -lt 18) { Write-Host "!! Node 18+ required (current: $(node -v))"; exit 1 }

if (-not (Test-Path .env) -and (Test-Path .env.example)) {
  Copy-Item .env.example .env
  Write-Host ">> Created .env from .env.example — edit VITE_SL_DATA_API_*"
}

Write-Host ">> Installing dependencies"
if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm install }
elseif (Test-Path pnpm-lock.yaml) { corepack enable; pnpm install }
elseif (Get-Command yarn -ErrorAction SilentlyContinue) { yarn install }
else { npm install }

Write-Host ">> Done. Run:  npm run dev"
