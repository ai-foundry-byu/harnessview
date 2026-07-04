#!/usr/bin/env bash
# One-shot publish: install → build → publish to npm.
# Requires ~/.npmrc with a valid publish token:
#   echo "//registry.npmjs.org/:_authToken=<token>" >> ~/.npmrc
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ installing deps..."
pnpm install --frozen-lockfile

echo "→ building..."
pnpm run build

echo "→ packing (dry run)..."
npm pack --dry-run

echo "→ publishing..."
npm publish --access public

echo "✓ published $(node -p 'require(\"./package.json\").name')@$(node -p 'require(\"./package.json\").version')"
