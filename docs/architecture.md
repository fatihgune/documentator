# Documentator Architecture

## What Documentator Is

Documentator is an AI-powered living documentation system. It analyzes microservice codebases, produces a structured YAML knowledge base, and keeps it current through a nightly update pipeline. The knowledge base is optimized for LLM consumption -- a cheap, fast model (Haiku) can answer documentation questions from it without needing access to the original source code.

## The Core Problem

Large organizations with microservice architectures accumulate tribal knowledge spread across dozens of repositories. Engineers waste hours tracing cross-service flows. Documentation goes stale within weeks of being written. Non-technical staff (sales, product) have no way to understand how features actually work.

## The Core Insight

Compress multi-repo tribal knowledge into an LLM-optimized retrieval format. Rather than having an expensive model navigate raw codebases every time someone asks a question, build a structured knowledge base once and update it incrementally. A cheap model reading the knowledge base answers faster and more accurately than an expensive model reading raw code.

## System Overview

```
                         Manual (developer)
                              |
                    +---------+---------+
                    |                   |
              /discover             /link
           (per repo)         (knowledge base)
                    |                   |
                    v                   v
              services/*.yaml     flows/**/*.yaml
                                  index.yaml
                                       |
                                       |  Automated (nightly)
                                       |
                              documentator-nightly
                              (clone, triage, re-discover, link, PR)
                                       |
                                       v
                              Auto-merged PR
                                       |
                              documentator-audit
                              (monthly accuracy measurement)
```

## Knowledge Base Structure

A knowledge base is a git repository containing three types of YAML files:

### Service Manifests (`services/*.yaml`)

One file per discovered repository. Contains:

- **Identity**: service name, repo URL, tech stack, discovery timestamp
- **Endpoints**: every API endpoint with route, request/response shapes, business rules
- **Outbound calls**: which other services this one calls, what data it sends, under what conditions
- **Data models**: core business entities with fields and relationships
- **Business rules**: conditional logic in plain English ("orders over $500 require approval")
- **Events**: Kafka topics, webhooks, queues -- published and consumed

Design principle: the schema is tech-stack agnostic. No framework classes, no ORM models, no annotations. The output describes what the service *does*, not how it's built. A product manager can read the business rules without knowing what Laravel is.

Schema: `src/schemas/service-manifest.schema.json`

### Flow Files (`flows/{domain}/{flow-name}.yaml`)

One file per cross-service business flow. A flow traces how a feature works end-to-end across multiple services. "Place Order" is a flow; "POST /orders" is an endpoint. Flows capture the stitching between services that no single repo documents.

Each flow names the trigger ("User clicks Place Order"), lists all services involved, and walks through the steps with branching logic and failure modes.

Schema: `src/schemas/flow.schema.json`

### Index (`index.yaml`)

Table of contents for the knowledge base. Lists all services with one-line summaries and endpoint counts, and all flows with summaries and involved services. This is the first file an LLM reads when answering a question -- it decides which manifests to load from here.

Schema: `src/schemas/index.schema.json`

## How Knowledge Bases Are Created

### Step 1: Discovery (`/discover` skill)

A developer runs `/discover` in Claude Code from within a service's repository. The skill analyzes the codebase in four passes:

1. **Orientation**: detect tech stack, enumerate routes, build skeleton
2. **Endpoint deep-dive**: for each endpoint, trace the code path from handler through service layer to data access and external calls
3. **Cross-cutting concerns**: events, scheduled jobs, middleware with business logic
4. **Assembly**: merge results, validate against schema, present for review

Output: a single `{service-name}.yaml` file.

For large services (50+ endpoints), the skill offers to process in batches or focus on a specific route prefix. In headless mode (used by the nightly pipeline), it processes everything without prompting.

**Scoped discovery** (`--scope`): when invoked with file paths or endpoint identifiers, the skill traces only those code paths and merges results into the existing manifest. This is how the nightly pipeline does targeted updates without re-analyzing entire codebases.

### Step 2: Linking (`/link` skill)

After discovering multiple services, a developer runs `/link` in the knowledge base repository. The skill:

1. Reads all service manifests and builds a directed graph of service-to-service connections
2. Identifies entry points (frontends, gateways, external event triggers)
3. Traces flows from each entry point through the connection graph
4. Enriches flows with business rules and branching logic from the manifests
5. Names and categorizes flows by business domain
6. Produces flow files and the index

Context management: the skill loads manifests in small groups as it traces connections, not all at once.

## How Knowledge Bases Stay Current

### Nightly Update Pipeline (`documentator-nightly`)

A standalone TypeScript CLI that runs on a cron via CI (GitHub Actions, Bitbucket Pipelines, Codefresh). It keeps the knowledge base in sync with the codebases it documents.

#### Pipeline Stages

**Stage 1 -- Clone & Detect Changes**

Reads all `services/*.yaml` to find tracked repos. Shallow-clones each one and checks `git log --since=<discovered timestamp>`. If no commits since last discovery, the repo is skipped.

Shallow clone uses a fallback chain: `--shallow-since` first, then `--depth=100`, then full clone. A sanity check verifies the clone reaches far enough back.

**Stage 1.5 -- Auto-Escalation**

Before triaging, checks if any changed files match configurable trigger patterns (package.json, Dockerfile, migration files, etc.). If a repo's diff touches one of these patterns, it skips triage and goes straight to full re-discover. This handles the most common category of changes that affect behavior without touching endpoint code.

Trigger patterns are configured in `documentator.config.yaml`. Per-repo only -- one repo escalating doesn't affect others.

**Stage 2 -- Targeted Triage**

For repos not auto-escalated: feeds the git diff + current manifest to an LLM. The LLM identifies which manifest sections are affected (specific endpoints, data models, business rules) and which source files should be re-read. Output includes both file paths (from the diff, authoritative) and endpoint identifiers (for scope targeting).

This is the only LLM call that reads diffs. Its output is a *triage signal*, not a manifest update. The actual re-discovery reads source code.

**Stage 3 -- Targeted Re-discover**

Invokes `/discover --headless --scope` on each changed repo. Auto-escalated repos get full re-discover (no scope). Triaged repos get scoped re-discover limited to the affected code paths.

Each updated manifest is validated against the schema. Failures are logged and retried next run (the `discovered` timestamp stays old).

**Stage 4 -- Link**

Re-links flows, but only if it's safe. Before linking, checks whether any failed repos participate in flows (using the index). Flows involving failed services are skipped to prevent building cross-service narratives from a mix of fresh and stale data. Flows not involving failed services are re-linked normally.

**Stage 5 -- PR & Notify**

Creates a branch with one commit per updated service manifest and a final commit for flows. If a bot PR already exists, updates it (force-push). Opens or updates the PR via a git provider adapter (GitHub or Bitbucket).

If `pr_auto_merge` is enabled and schema validation passes, the PR merges automatically. The notification hook is called with a JSON summary regardless of outcome.

#### Configuration

`documentator.config.yaml` in the knowledge base repo root:

```yaml
notification_hook: ./hooks/notify.sh   # called with JSON summary on stdin
pr_auto_merge: true                     # merge if schema validation passes
claude_model: sonnet                    # model for discovery/linking
concurrency: sequential                 # sequential | parallel | <number>

full_rediscover_triggers:               # file patterns that bypass triage
  - "package.json"
  - "package-lock.json"
  - "composer.json"
  - "composer.lock"
  - "build.gradle"
  - "build.gradle.kts"
  - "Dockerfile"
  - "*.migration.*"
  - "db/migrations/**"
  - ".env.example"
```

All fields are optional. Defaults apply when absent.

#### Error Handling

- **Per-repo failure**: that repo is skipped, its manifest stays stale, it's retried next run. Flows involving the failed service are not re-linked.
- **Whole-run failure**: notification hook is called with the error, no PR created, next run retries everything.
- **Triage failure**: the repo is auto-escalated to full re-discover.
- **Link failure**: non-fatal. Manifest updates are still committed.

#### Run Summary

Every run produces a JSON summary sent to the notification hook:

```json
{
  "date": "2026-03-27",
  "services_tracked": 15,
  "services_changed": 3,
  "services_auto_escalated": 1,
  "services_triaged": 2,
  "services_updated": 2,
  "services_failed": [{"name": "comms-service", "error": "timeout"}],
  "flows_relinked": true,
  "flows_skipped": ["Send Notification"],
  "tokens_used": 142300,
  "pr_url": "https://github.com/company/knowledge-base/pull/42",
  "pr_merged": true
}
```

### Accuracy Audit (`documentator-audit`)

A separate tool that measures how well the nightly triage is working. Run monthly or on-demand.

Process:
1. Full re-discover (headless, no scope) on all tracked repos
2. Diff the fresh manifests against the current knowledge base state
3. For each discrepancy: identify which file changes in historical diffs caused the miss
4. Produce an accuracy report with triage accuracy percentage and drift details

The "why" data (which diff files corresponded to missed sections) is the actionable output -- it tells you how to improve the triage prompt, not just that it was wrong.

No scheduled full re-discover exists as a safety net. Instead: auto-escalation handles predictable blind spots deterministically, the accuracy audit measures triage quality, and `workflow_dispatch` provides an on-demand manual trigger for post-refactor scenarios.

### Accepted Risk: Semantic Correctness

Schema validation gates auto-merge but cannot catch hallucinated endpoints or incorrect business rule descriptions. This is explicitly accepted because:

1. Each nightly update reads real source code, not just diffs
2. The accuracy audit measures drift over time
3. The knowledge base is version-controlled -- bad merges are revertible
4. Manifests are overwritten on re-discover, so errors don't compound indefinitely

## Platform Support

The pipeline is platform-agnostic. The core logic runs as a Node.js script. Platform-specific concerns are isolated:

- **Git hosting**: adapters for GitHub (`gh` CLI) and Bitbucket (REST API). Auto-detected from remote URL, overridable via `DOCUMENTATOR_GIT_PROVIDER` env var.
- **CI triggers**: example workflow files for GitHub Actions and Bitbucket Pipelines. The CI config just sets env vars and runs the script.
- **LLM provider**: Claude via AWS Bedrock (IAM auth). Model configurable via `claude_model` in config.
- **Auth**: all credentials via environment variables set by the CI platform.

## How the Knowledge Base Is Consumed

### By Developers (Claude Code)

Developers clone the knowledge base repo and use Claude Code to query it. The `CLAUDE.md` template (installed into knowledge base repos) instructs the model to:

1. Read `index.yaml` first
2. Load only relevant manifests/flows based on the question
3. Answer in business language with specific field names and conditions

### By Non-Technical Users (Future)

A lightweight web frontend that takes a question, loads relevant knowledge base files into an LLM call, and returns the answer. Deferred to a future version.

## Project Structure

```
documentator/
  src/
    schemas/                     # JSON Schema definitions
      service-manifest.schema.json
      flow.schema.json
      index.schema.json
    validate.ts                  # Schema validation (library + CLI)
    nightly/                     # Nightly update pipeline
      types.ts                   # Shared interfaces
      config.ts                  # Config parser (documentator.config.yaml)
      clone.ts                   # Stage 1: clone & change detection
      escalation.ts              # Stage 1.5: auto-escalation patterns
      triage.ts                  # Stage 2: LLM triage
      rediscover.ts              # Stage 3: targeted re-discover
      link.ts                    # Stage 4: link decision logic
      pr.ts                      # Stage 5: PR creation & notification
      runner.ts                  # Pipeline orchestrator
      cli.ts                     # CLI entry point
    audit/                       # Accuracy audit tool
      runner.ts                  # Manifest diffing & reporting
      cli.ts                     # CLI entry point
  skills/
    discover.md                  # /discover skill (interactive + headless)
    link.md                      # /link skill (interactive + headless)
  adapters/
    github.sh                    # GitHub PR adapter (gh CLI)
    bitbucket.sh                 # Bitbucket PR adapter (REST API)
  templates/
    CLAUDE.md                    # Template for knowledge base repos
  examples/
    github-actions-nightly.yml   # CI example: nightly pipeline
    github-actions-audit.yml     # CI example: accuracy audit
    bitbucket-pipelines.yml      # CI example: Bitbucket
  tests/
    validate.test.ts             # Schema validation tests
    nightly/                     # Pipeline unit tests
    audit/                       # Audit unit tests
    fixtures/                    # YAML test fixtures
```

## Design Decisions

### Diffs for Triage, Source Code for Updates

Diffs are syntactic; manifests are semantic. A one-line change to `if (total > 500)` is a trivial diff but a significant business rule change. The LLM needs to read the actual code path to produce an accurate manifest update. Diffs tell us *where* to look; source code tells us *what changed*.

### No Scheduled Full Re-discover

The weekly full re-discover was replaced by three mechanisms: auto-escalation (deterministic, handles predictable blind spots like dependency bumps), the accuracy audit (measures whether triage is good enough), and on-demand manual trigger (for major refactors). This avoids paying for weekly full re-discovers "just in case" while providing evidence-based confidence in triage quality.

### Partial Failure Safety

Each manifest is a complete snapshot of its repo at discovery time. A stale manifest is correct for an older point in time; it's never internally inconsistent. This means partial failures are safe -- 2 out of 3 successful updates still improve the knowledge base. Flows are the exception: they combine data from multiple manifests, so they're only re-linked when all participating services are current.

### Tech-Stack Agnosticism

The schema has no framework-specific fields. No slots for Laravel Resources, Spring annotations, or Express middleware. Framework boilerplate is filtered during discovery by the nature of the output format. This means the same schema, validation, and pipeline work for any tech stack.

### Skills Over Application Code

Discovery and linking intelligence lives in prompt text (skills), not in application logic. The pipeline orchestration is TypeScript, but the actual analysis is done by the LLM following skill instructions. This means improving discovery quality is a prompt engineering task, not a code change.
