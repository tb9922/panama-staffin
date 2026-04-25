#!/usr/bin/env bash
set -euo pipefail

local_full="$(git rev-parse HEAD)"
local_short="$(git rev-parse --short HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
tags="$(git tag --points-at HEAD | tr '\n' ' ')"

echo "Local branch: $branch"
echo "Local HEAD:   $local_short"
echo "Local tags:   ${tags:-none}"

if git remote get-url origin >/dev/null 2>&1; then
  origin_full="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
  origin_short="${origin_full:0:7}"
  echo "Origin main:  ${origin_short:-unknown}"
  if [[ -n "$origin_full" && "$origin_full" != "$local_full" ]]; then
    echo "WARNING: local HEAD does not match origin/main" >&2
  fi
fi

if [[ -n "${VPS_HOST:-}" && -n "${VPS_PATH:-}" ]]; then
  ssh_target="${VPS_USER:-root}@$VPS_HOST"
  ssh_cmd=(ssh)
  if [[ -n "${VPS_SSH_KEY:-}" ]]; then
    ssh_cmd+=(-i "$VPS_SSH_KEY")
  fi
  if [[ -n "${VPS_SSH_OPTS:-}" ]]; then
    # shellcheck disable=SC2206
    ssh_cmd+=(${VPS_SSH_OPTS})
  fi
  vps_head="$("${ssh_cmd[@]}" "$ssh_target" "cd '$VPS_PATH' && git rev-parse --short HEAD")"
  echo "VPS HEAD:     $vps_head"
  if [[ "$vps_head" != "$local_short" ]]; then
    echo "WARNING: local HEAD does not match VPS HEAD" >&2
  fi
else
  echo "VPS HEAD:     skipped (set VPS_HOST and VPS_PATH)"
fi
