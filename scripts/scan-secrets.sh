#!/usr/bin/env bash
# Scan the whole working tree AND full git history for credential-shaped
# strings. Run before making the repo public.
set -uo pipefail
pat='AIza[0-9A-Za-z_-]{35}|sk-ant-[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{36}'
echo "== tracked files =="
if git grep -nIE "$pat" -- . ':!*.lock' ':!package-lock.json' 2>/dev/null; then
  echo "!!! FOUND in working tree"; else echo "clean"; fi
echo
echo "== full history =="
if git log -p --all 2>/dev/null | grep -nE "$pat" >/dev/null; then
  echo "!!! FOUND in history — a rewrite is required before going public"
else echo "clean"; fi
