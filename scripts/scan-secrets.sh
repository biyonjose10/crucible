#!/usr/bin/env bash
#
# Scan the working tree AND full git history for credential-shaped strings.
# Run before any push; CI runs it on every commit.
#
# This script previously ended on an `echo`, which meant it always exited 0 —
# the CI gate could never fail, no matter what it found. A guard that cannot
# fail is worse than no guard, because it is trusted.

set -uo pipefail

pat='AIza[0-9A-Za-z_-]{35}|sk-ant-[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

found=0

echo "== tracked files =="
# git grep exits 0 on a match, 1 on none. A match is the failure case here.
if git grep -nIE "$pat" -- . ':!*.lock' ':!package-lock.json' ':!scripts/scan-secrets.sh' ':!.githooks/pre-commit'; then
  echo "!!! credential-shaped string found in the working tree"
  found=1
else
  echo "clean"
fi

echo
echo "== full history =="
# Filenames only: never print the match itself.
if git log -p --all -G"$pat" --format='%H %s' 2>/dev/null | grep -qE '^[0-9a-f]{7,} '; then
  echo "!!! credential-shaped string found in history; commits:"
  git log --all -G"$pat" --format='  %h %s' 2>/dev/null | head -20
  echo "A history rewrite is required before this repo can be public."
  found=1
else
  echo "clean"
fi

echo
if [ "$found" -ne 0 ]; then
  echo "SECRET SCAN FAILED"
  exit 1
fi
echo "SECRET SCAN PASSED"
exit 0
