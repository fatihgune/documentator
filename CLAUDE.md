# Documentator

AI-powered living documentation engine. Produces LLM-optimized knowledge bases from codebases.

## Project structure

- `src/schemas/` — JSON Schema definitions for the knowledge base format
- `src/validate.ts` — Schema validation utility (library + CLI)
- `skills/discover.md` — Claude Code skill for codebase discovery
- `skills/link.md` — Claude Code skill for cross-service flow generation
- `templates/CLAUDE.md` — Template for knowledge base repo consumption
- `tests/` — Vitest tests with YAML fixtures

## Commands

- `npm test` — run all tests
- `npx tsx src/validate.ts <file.yaml>` — validate a knowledge base file

## Schema files

The three schema types are: service manifests (`services/*.yaml`), flow files (`flows/**/*.yaml`), and the index (`index.yaml`). JSON Schemas are in `src/schemas/`.

## Skills

Skills are installed into Claude Code by copying to `.claude/commands/` or referencing from project settings. See `skills/` directory.
