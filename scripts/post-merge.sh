#!/bin/bash
set -e

if ! pnpm install --frozen-lockfile; then
  echo "Frozen install could not reconcile workspace metadata; refreshing the lockfile."
  pnpm install --no-frozen-lockfile
fi

pnpm --filter db push
