#!/usr/bin/env bash
# adapters/bitbucket.sh
# Bitbucket PR adapter using REST API via curl.
# Requires: BITBUCKET_WORKSPACE, BITBUCKET_REPO_SLUG, BITBUCKET_APP_PASSWORD, BITBUCKET_USERNAME

set -euo pipefail

API_BASE="https://api.bitbucket.org/2.0"

create_pr() {
  local branch="$1"
  local title="$2"
  local body="$3"

  local response
  response=$(curl -s -X POST \
    -u "${BITBUCKET_USERNAME}:${BITBUCKET_APP_PASSWORD}" \
    -H "Content-Type: application/json" \
    "${API_BASE}/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests" \
    -d "{
      \"title\": \"${title}\",
      \"description\": \"${body}\",
      \"source\": {\"branch\": {\"name\": \"${branch}\"}},
      \"destination\": {\"branch\": {\"name\": \"main\"}}
    }")

  echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['links']['html']['href'])" 2>/dev/null || echo "$response"
}

merge_pr() {
  local pr_id="$1"
  curl -s -X POST \
    -u "${BITBUCKET_USERNAME}:${BITBUCKET_APP_PASSWORD}" \
    "${API_BASE}/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${pr_id}/merge"
}

add_pr_comment() {
  local pr_id="$1"
  local comment="$2"
  curl -s -X POST \
    -u "${BITBUCKET_USERNAME}:${BITBUCKET_APP_PASSWORD}" \
    -H "Content-Type: application/json" \
    "${API_BASE}/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${pr_id}/comments" \
    -d "{\"content\": {\"raw\": \"${comment}\"}}"
}

# Dispatch to function
"$@"
