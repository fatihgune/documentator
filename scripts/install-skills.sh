#!/usr/bin/env bash
# Install Documentator skills into Claude Code.
# Run from the documentator repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

DISCOVER_DIR="$HOME/.claude/skills/documentator:discover"
LINK_DIR="$HOME/.claude/skills/documentator:link"

mkdir -p "$DISCOVER_DIR" "$LINK_DIR"

cp "$REPO_DIR/skills/discover.md" "$DISCOVER_DIR/SKILL.md"
cp "$REPO_DIR/skills/link.md" "$LINK_DIR/SKILL.md"

echo "Skills installed:"
echo "  /discover -> $DISCOVER_DIR/SKILL.md"
echo "  /link     -> $LINK_DIR/SKILL.md"
echo ""
echo "Restart Claude Code to pick up the new skills."
