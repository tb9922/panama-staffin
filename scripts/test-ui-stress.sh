#!/usr/bin/env bash
# Run the aggressive UI button sweep against the disposable E2E database.
set -euo pipefail

export PANAMA_INCLUDE_STRESS=1
bash ./scripts/test-e2e.sh tests/e2e/stress/ui-button-sweep.spec.js --project=chromium "$@"
