#!/usr/bin/env bash
# Point git at the versioned hooks directory. Run once per clone.
set -euo pipefail
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "hooks enabled: $(git config core.hooksPath)"
