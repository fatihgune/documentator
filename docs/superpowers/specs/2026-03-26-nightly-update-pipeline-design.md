# Nightly Update Pipeline Design Spec

## Problem

Knowledge bases built by Documentator v1 go stale as codebases evolve. Manual re-discovery is tedious, and developers forget to do it. Services with 200+ endpoints make full re-discovery expensive -- the update mechanism needs to be smart about what it re-analyzes.

## Solution

A standalone orchestration script, triggered nightly via CI (GitHub Actions, Codefresh, Bitbucket Pipelines), that:

1. Identifies which tracked repos have changed since their last discovery
2. Auto-escalates repos with infrastructure-level changes (dependency bumps, migrations) to full re-discover
3. Uses diffs to triage which manifest sections are affected in remaining repos
4. Re-discovers only the affected code paths by reading actual source code (not interpreting diffs semantically)
5. Re-links flows if all relevant discoveries succeed
6. Opens a PR, auto-merges if validation passes, posts a digest notification

A separate accuracy audit tool (run monthly or on-demand) measures triage quality by diffing full re-discover output against accumulated nightly state.

### Key Design Decisions

- **Diffs for triage, source code for updates.** Diffs identify *where* to look. The LLM reads the actual current source code to produce manifest updates, avoiding the reliability problems of semantic diff interpretation.
- **Auto-escalation for infrastructure changes.** Configurable file patterns (package.json, Dockerfile, migration files) trigger full re-discover for that repo, bypassing triage. Converts predictable blind spots into deterministic handling.
- **No scheduled full re-discover.** Instead: auto-escalation handles predictable blind spots, a separate accuracy audit measures triage quality, and an on-demand manual trigger covers major refactors. The weekly full re-discover safety net is replaced by measurement and targeted handling.
- **Repo list derived from manifests.** No separate config for which repos to track. First discovery of a new repo stays manual and interactive.
- **Partial failure is safe.** Each manifest is a complete snapshot. If some repos fail, their manifests stay stale but correct. Flows are only re-linked when failed repos don't participate in any flows (checked against the index), preventing inconsistent cross-service narratives without being overly conservative.
- **Platform-agnostic core.** The script has no CI platform dependency. Git provider adapters (GitHub, Bitbucket) handle the PR API differences. CI config files are thin wrappers.
- **Auto-merge with digest.** No human approval bottleneck. Schema validation gates the merge. A notification hook lets teams wire up Slack/email awareness.
- **Accepted risk: semantic correctness.** Schema validation catches structural problems but not hallucinated endpoints or incorrect business rule descriptions. This is accepted because: (a) each nightly update reads real source code, not just diffs, (b) the accuracy audit measures drift, (c) the knowledge base is version-controlled so bad merges are revertible, (d) manifests are overwritten on re-discover, so errors don't compound indefinitely.

---

## Component 1: Configuration

A `documentator.config.yaml` in the knowledge base repo root:

```yaml
notification_hook: ./hooks/notify.sh  # called with JSON summary on stdin
pr_auto_merge: true  # merge if schema validation passes
claude_model: sonnet  # model for discovery/linking
concurrency: sequential  # sequential | parallel | <number>

# File patterns that trigger full re-discover for the affected repo.
# If any file in a repo's diff matches these patterns, that repo skips
# triage and goes straight to full re-discover. Per-repo only -- does
# not cascade to other repos.
full_rediscover_triggers:
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

No repo list in config -- derived from `services/*.yaml` at runtime. Teams extend `full_rediscover_triggers` with their own patterns (Terraform files, Helm charts, etc.) without touching pipeline code.

The notification hook receives a JSON summary on stdin. Teams implement the hook to post to Slack, email, or any other channel.

---

## Component 2: Pipeline Stages

Five sequential stages:

### Stage 1 -- Clone & Detect Changes

- Read all `services/*.yaml` in the knowledge base, extract `repo` and `discovered` fields
- Shallow-clone each repo using `git clone --shallow-since=<discovered>`
- **Sanity check:** after cloning, verify the oldest available commit predates the `discovered` timestamp. If not, deepen with `--depth=100`. If still insufficient, fall back to full clone. This guards against `--shallow-since` unreliability across git hosting platforms.
- For each repo: `git log --since=<discovered>` -- if no commits, skip
- Collect diffs for repos with changes
- Output: list of changed repos with their diffs

### Stage 1.5 -- Auto-escalation Check

- For each changed repo: check if any files in the diff match `full_rediscover_triggers` patterns
- Matching repos are flagged for full re-discover (skip Stage 2, go directly to Stage 3 with no `--scope`)
- This is a deterministic file-pattern check, no LLM call needed
- Per-repo only -- does not cascade to other repos

### Stage 2 -- Targeted Triage

- For each changed repo **not auto-escalated**: feed the diff + current manifest to the LLM (cheap call)
- LLM identifies which manifest sections are affected: specific endpoints, outbound calls, data models, business rules, events
- Flags shared code changes (base classes, middleware, helpers) that could affect sections not directly in the diff
- Output includes **both file paths and endpoint identifiers** for the affected sections. File paths come from the diff and are more robust than endpoint identifiers alone, since the stale manifest may point to renamed/moved files.
- Output: per-repo list of manifest sections and source file paths to re-discover

### Stage 3 -- Targeted Re-discover

- **Auto-escalated repos:** full re-discover with no `--scope` (reads entire codebase)
- **Triaged repos:** the LLM reads the **actual current source code** at the file paths identified in Stage 2, traces those code paths, and rewrites the affected manifest sections
- Not diff interpretation -- the LLM traces code paths from endpoint to data access, same as `/discover`, but scoped
- Unaffected manifest sections are left untouched
- Each updated manifest is validated against the schema
- Output: updated manifests, plus a list of any failures with error details

### Stage 4 -- Link

- Check whether any failed repos participate in flows (look up failed service names in `index.yaml` flow entries)
- **If failed repos have no flow connections:** re-link proceeds for all successful repos. The failed repos' stale manifests don't affect any flows.
- **If failed repos participate in flows:** skip re-linking only for the affected flows. Flows that don't involve failed repos are still re-linked.
- Runs `/link --headless` to regenerate affected flows and update the index
- Detects affected flows by comparing the connection graph before and after manifest changes

### Stage 5 -- PR & Notify

- Check for an existing open `documentator/nightly-*` PR
  - If one exists: update the existing branch (force-push, since the branch is bot-owned and commits are rewritten per-service)
  - If none: create branch `documentator/nightly-YYYY-MM-DD`
- One commit per updated service manifest (reviewers can navigate by commit)
- Final commit for flow + index updates (if Stage 4 produced changes)
- Open or update PR via git provider adapter
- Run schema validation on all changed files
- If validation passes and `pr_auto_merge: true`: merge automatically
- Call notification hook with run summary regardless of outcome

---

## Component 3: Discover Skill Changes

The existing `/discover` skill gains a `--headless` mode:

- **Skips interactive prompts.** No "discover all or filter?" question. Processes what it's told.
- **Skips human review.** Writes output directly.
- **Accepts `--scope` parameter.** Takes file paths and/or endpoint identifiers: `--scope "src/controllers/OrderController.php, src/services/OrderService.php"` or `--scope "POST /orders, data_models.Order"`. File paths are preferred when available (more robust against stale manifest mappings). Only traces those code paths. The rest of the manifest is left untouched.
- **Without `--scope`** (full re-discover): behaves like the current skill minus interactive prompts.

The skill remains a single file. The headless flag changes the instruction preamble, not the core discovery logic.

---

## Component 4: Link Skill Changes

The existing `/link` skill gains a `--headless` mode:

- Skips interactive output and review
- Writes flows and index directly
- Detects which flows are affected by manifest changes, only re-processes those

---

## Component 5: Git Provider Adapters

Small scripts, one per supported provider:

- `adapters/github.sh` -- uses `gh` CLI
- `adapters/bitbucket.sh` -- uses Bitbucket REST API via `curl`

Each adapter implements three functions:
- `create_pr(branch, title, body)` -- opens a pull request
- `merge_pr(pr_id)` -- merges the pull request
- `add_pr_comment(pr_id, comment)` -- adds a comment (for failure notes)

Auto-detection: parse `git remote get-url origin`. `github.com` -> GitHub adapter, `bitbucket.org` -> Bitbucket adapter. Override via `DOCUMENTATOR_GIT_PROVIDER` env var.

Auth is provided via environment variables set by the CI platform (`GIT_TOKEN`, `GITHUB_TOKEN`, `BITBUCKET_APP_PASSWORD`, etc.).

---

## Component 6: Error Handling

### Per-repo Failures

If a repo fails during Stage 3 (timeout, auth error, schema validation failure):
- That repo is skipped
- Its manifest retains the old `discovered` timestamp, so it will be retried next run
- The failure is noted in the PR body and notification digest
- Stage 4 (link) checks whether the failed repo participates in any flows before deciding what to re-link (see Stage 4 above)

### Whole-run Failures

If the pipeline itself fails (can't clone, Bedrock auth fails, disk full):
- The notification hook is still called with the error
- No PR is created
- Next run retries everything

### Run Summary Format

```json
{
  "date": "2026-03-27",
  "services_tracked": 15,
  "services_changed": 3,
  "services_auto_escalated": 1,
  "services_triaged": 2,
  "services_updated": 2,
  "services_failed": [
    {"name": "comms-service", "error": "Claude timeout after 120s"}
  ],
  "flows_relinked": true,
  "flows_skipped": ["send-notification"],
  "tokens_used": 142300,
  "pr_url": "https://github.com/company/knowledge-base/pull/42",
  "pr_merged": true
}
```

---

## Component 7: Accuracy Audit (Separate Tool)

A separate script and CI workflow, independent from the nightly pipeline. Purpose: measure triage quality and provide prompt tuning data.

### How it works

1. Run full re-discover (headless, no scope) on all tracked repos
2. Diff the full re-discover output against the current knowledge base state (accumulated nightly updates)
3. For each discrepancy: identify which file changes in historical diffs corresponded to the missed sections (this is the prompt tuning data -- knowing *what* triage missed tells you it's wrong, knowing *why* tells you how to fix it)
4. Produce an accuracy report

### Accuracy Report Format

```json
{
  "date": "2026-03-27",
  "services_audited": 15,
  "services_with_drift": 2,
  "triage_accuracy": 0.94,
  "drift_details": [
    {
      "service": "order-service",
      "missed_sections": ["endpoints[POST /orders].business_rules"],
      "likely_cause": "config change in .env.example (ORDER_THRESHOLD) on 2026-03-20",
      "corresponding_diff_files": [".env.example", "config/orders.php"]
    }
  ],
  "tokens_used": 890000
}
```

### Triggering

- **On-demand:** `workflow_dispatch` (or equivalent) for post-refactor, post-major-upgrade, or "I don't trust the nightly" scenarios
- **Scheduled:** monthly cadence recommended, but entirely optional. Teams with few repos where cost is negligible may skip it
- **Separate CI workflow file** -- not mixed into the nightly pipeline config

---

## CI Wrapper Examples

### GitHub Actions -- Nightly Pipeline

```yaml
# .github/workflows/documentator-nightly.yml
name: Documentator Nightly Update
on:
  schedule:
    - cron: '0 2 * * *'  # 2am daily
  workflow_dispatch:
    inputs:
      full_rediscover:
        description: 'Force full re-discover on all repos'
        type: boolean
        default: false

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx documentator-nightly
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AWS_REGION: ${{ vars.AWS_REGION }}
          FORCE_FULL_REDISCOVER: ${{ inputs.full_rediscover }}
```

### GitHub Actions -- Accuracy Audit

```yaml
# .github/workflows/documentator-audit.yml
name: Documentator Accuracy Audit
on:
  schedule:
    - cron: '0 4 1 * *'  # 4am, 1st of each month
  workflow_dispatch: {}

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx documentator-audit
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AWS_REGION: ${{ vars.AWS_REGION }}
```

### Bitbucket Pipelines

```yaml
# bitbucket-pipelines.yml
pipelines:
  custom:
    documentator-nightly:
      - step:
          name: Nightly Knowledge Base Update
          script:
            - npm ci
            - npx documentator-nightly
    documentator-audit:
      - step:
          name: Accuracy Audit
          script:
            - npm ci
            - npx documentator-audit
```

---

## Schema Changes

### Service Manifest

No breaking changes. The `discovered` timestamp is already in the schema and serves as the "last updated" marker for triage.

### Index

No changes required.

### New: documentator.config.yaml

Not validated by JSON Schema (it's tooling config, not knowledge base content). Validated by the script at startup with clear error messages for missing/invalid fields.

### New: .documentator-state.json

Committed to the knowledge base repo. Tracks pipeline state:

```json
{
  "last_nightly_run": "2026-03-27T02:00:00Z",
  "last_accuracy_audit": "2026-03-01T04:00:00Z",
  "last_audit_accuracy": 0.94
}
```

---

## Success Criteria

The nightly pipeline is successful if:

1. On a nightly run with 3 out of 15 repos changed, only those 3 repos are re-discovered (not all 15)
2. For a 200-endpoint service where 2 endpoints changed, only those 2 code paths are re-analyzed (not all 200)
3. A dependency bump (matching `full_rediscover_triggers`) auto-escalates to full re-discover for that repo only, without cascading to other repos
4. Manifests produced by targeted re-discover are equivalent to what a full re-discover would produce for the affected sections
5. A partial failure (1 of 3 repos fails) still produces a PR with the 2 successful updates, and flows not involving the failed repo are re-linked
6. The pipeline works with both GitHub and Bitbucket without code changes (only CI config and env vars differ)
7. The accuracy audit produces actionable data: which sections triage missed and which file changes caused the miss
