# Documentator

AI-powered living documentation engine. Produces LLM-optimized knowledge bases from codebases.

## Project structure

- `src/schemas/` — JSON Schema definitions for the knowledge base format
- `src/validate.ts` — Schema validation utility (library + CLI)
- `src/nightly/` — Nightly update pipeline (clone, triage, re-discover, link, PR)
- `src/audit/` — Accuracy audit tool (full re-discover + diff)
- `skills/discover.md` — `/documentator:discover` skill for codebase discovery
- `skills/link.md` — `/documentator:link` skill for cross-service flow generation
- `adapters/` — Git provider adapters (GitHub, Bitbucket)
- `examples/` — CI workflow examples
- `templates/CLAUDE.md` — Template for knowledge base repo consumption
- `tests/` — Vitest tests with YAML fixtures

## Commands

- `npm test` — run all tests
- `npx tsx src/validate.ts <file.yaml>` — validate a knowledge base file
- `npx tsx src/nightly/cli.ts` — run the nightly update pipeline (from knowledge base repo root)
- `npx tsx src/audit/cli.ts` — run the accuracy audit (from knowledge base repo root)

## Schema files

The three schema types are: service manifests (`services/*.yaml`), flow files (`flows/**/*.yaml`), and the index (`index.yaml`). JSON Schemas are in `src/schemas/`.

## Skills

Skills are installed into Claude Code by copying to `.claude/commands/` or referencing from project settings. See `skills/` directory.
