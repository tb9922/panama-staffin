#!/bin/bash

# Load selected KEY=VALUE entries from a dotenv file without evaluating shell
# syntax. This keeps values containing "$" or other shell metacharacters intact
# when scripts run from cron.
load_env_keys() {
  local env_file="$1"
  shift || true

  [ -f "$env_file" ] || return 0

  local key line value first last
  for key in "$@"; do
    [ -n "${!key:-}" ] && continue

    line=$(grep -m 1 -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" || true)
    [ -n "$line" ] || continue

    line="${line%$'\r'}"
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"
      last="${value: -1}"
      if { [ "$first" = '"' ] || [ "$first" = "'" ]; } && [ "$first" = "$last" ]; then
        value="${value:1:${#value}-2}"
      fi
    fi

    export "$key=$value"
  done
}
