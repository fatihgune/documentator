#!/usr/bin/env bash
# adapters/github.sh
# GitHub PR adapter using gh CLI.
# Functions: create_pr, merge_pr, add_pr_comment

set -euo pipefail

create_pr() {
  local branch="$1"
  local title="$2"
  local body="$3"

  # Check if PR already exists for this branch
  existing=$(gh pr view "$branch" --json url -q .url 2>/dev/null || true)
  if [ -n "$existing" ]; then
    echo "$existing"
    return 0
  fi

  gh pr create --title "$title" --body "$body" --head "$branch"
}

merge_pr() {
  local pr_id="$1"
  gh pr merge "$pr_id" --merge --auto
}

add_pr_comment() {
  local pr_id="$1"
  local comment="$2"
  gh pr comment "$pr_id" --body "$comment"
}

# Dispatch to function
"$@"
