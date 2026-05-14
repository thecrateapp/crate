#!/bin/bash
# Wrapper for ESLint in pre-commit that runs from the correct app directory.
set -e

APP_DIR="$1"
shift

# Convert repo-root-relative paths to app-relative paths
REL_PATHS=()
for p in "$@"; do
    REL_PATHS+=("${p#${APP_DIR}/}")
done

cd "${APP_DIR}" && npx eslint --fix "${REL_PATHS[@]}"
