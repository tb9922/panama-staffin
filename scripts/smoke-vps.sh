#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
HOME_SLUG="${HOME_SLUG:-}"

if [[ -z "${SMOKE_USERNAME:-}" || -z "${SMOKE_PASSWORD:-}" ]]; then
  echo "SMOKE_USERNAME and SMOKE_PASSWORD are required" >&2
  exit 2
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl_status() {
  local method="$1"
  local path="$2"
  local out="$tmp_dir/response.json"
  local code
  code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path")"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "$method $path failed with HTTP $code" >&2
    cat "$out" >&2 || true
    exit 1
  fi
  echo "$method $path -> $code"
}

curl_auth_get() {
  local path="$1"
  local query="$path"
  if [[ -n "$HOME_SLUG" ]]; then
    if [[ "$query" == *"?"* ]]; then
      query="$query&home=$HOME_SLUG"
    else
      query="$query?home=$HOME_SLUG"
    fi
  fi
  local out="$tmp_dir/response.json"
  local code
  code="$(curl -sS -o "$out" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE_URL$query")"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "GET $query failed with HTTP $code" >&2
    cat "$out" >&2 || true
    exit 1
  fi
  echo "GET $query -> $code"
}

curl_status GET /health
curl_status GET /readiness

login_body="$tmp_dir/login.json"
node -e "process.stdout.write(JSON.stringify({ username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD }))" > "$login_body"
login_response="$tmp_dir/login-response.json"
login_code="$(curl -sS -o "$login_response" -w '%{http_code}' -H 'Content-Type: application/json' -d @"$login_body" "$BASE_URL/api/login")"
if [[ "$login_code" -lt 200 || "$login_code" -ge 300 ]]; then
  echo "POST /api/login failed with HTTP $login_code" >&2
  cat "$login_response" >&2 || true
  exit 1
fi

TOKEN="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if (!data.token) process.exit(1); process.stdout.write(data.token);" "$login_response")"
echo "POST /api/login -> $login_code"

curl_auth_get /api/homes
curl_auth_get /api/audit
curl_auth_get /api/gdpr/access-log

echo "Smoke checks passed for $BASE_URL"
