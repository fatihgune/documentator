# Nightly Update Pipeline Design Spec

## Problem

Knowledge bases built by Documentator v1 go stale as codebases evolve. Manual re-discovery is tedious, and developers forget to do it. Services with 200+ endpoints make full re-discovery expensive -- the update mechanism needs to be smart about what it re-analyzes.

## Solution

A standalone orchestration script, triggered nightly via CI (GitHub Actions, Codefresh, Bitbucket Pipelines), that:

1. Identifies which tracked repos have changed since their last discovery
2. Uses diffs to triage which manifest sections are affected
3. Re-discovers only the affected code paths by reading actual source code (not interpreting diffs semantically)
4. Re-links flows if all discoveries succeed
5. Opens a PR, auto-merges if validation passes, posts a digest notification

A configurable periodic full re-discover (default weekly) catches any drift the triage step missed.

### Key Design Decisions

- **Diffs for triage, source code for updates.** Diffs identify *where* to look. The LLM reads the actual current source code to produce manifest updates, avoiding the reliability problems of semantic diff interpretation.
- **Repo list derived from manifests.** No separate config for which repos to track. First discovery of a new repo stays manual and interactive.
- **Partial failure is safe.** Each manifest is a complete snapshot. If some repos fail, their manifests stay stale but correct. Flows are only re-linked when all changed repos succeed, preventing inconsistent cross-service narratives.
- **Platform-agnostic core.** The script has no CI platform dependency. Git provider adapters (GitHub, Bitbucket) handle the PR API differences. CI config files are thin wrappers.
- **Auto-merge with digest.** No human approval bottleneck. Schema validation gates the merge. A notification hook lets teams wire up Slack/email awareness.

---

## Component 1: Configuration

A `documentator.config.yaml` in the knowledge base repo root:

```yaml
full_rediscover_interval: weekly  # weekly | monthly | daily | never
notification_hook: ./hooks/notify.sh  # called with JSON summary on stdin
pr_auto_merge: true  # merge if schema validation passes
claude_model: sonnet  # model for discovery/linking
```

No repo list in config -- derived from `services/*.yaml` at runtime.

The notification hook receives a JSON summary on stdin containing: changed services, failures, PR URL, whether flows were re-linked, next full re-discover date. Teams implement the hook to post to Slack, email, or any other channel.

---

## Component 2: Pipeline Stages

Five sequential stages:

### Stage 1 -- Clone & Detect Changes

- Read all `services/*.yaml` in the knowledge base, extract `repo` and `discovered` fields
- Shallow-clone each repo with enough history to reach the `discovered` timestamp
- For each repo: `git log --since=<discovered>` -- if no commits, skip
- Collect diffs for repos with changes
- Output: list of changed repos with their diffs

### Stage 2 -- Targeted Triage

- For each changed repo: feed the diff + current manifest to the LLM (cheap call)
- LLM identifies which manifest sections are affected: specific endpoints, outbound calls, data models, business rules, events
- Flags shared code changes (base classes, middleware, helpers) that could affect sections not directly in the diff
- Output: per-repo list of manifest sections to re-discover

### Stage 3 -- Targeted Re-discover

- For each affected section: the LLM reads the **actual current source code** for those code paths and rewrites the manifest sections
- Not diff interpretation -- the LLM traces the code path from endpoint to data access, same as `/discover`, but scoped to specific sections
- Unaffected manifest sections are left untouched
- Each updated manifest is validated against the schema
- Output: updated manifests, plus a list of any failures

### Stage 4 -- Link

- **Only runs if all changed repos in Stage 3 succeeded**
- If some repos failed: skip this stage entirely. Flows stay consistent with the previous state. Only successful manifest updates are committed.
- Runs `/link --headless` to regenerate affected flows and update the index
- Detects affected flows by comparing the connection graph before and after manifest changes

### Stage 5 -- PR & Notify

- Create branch `documentator/nightly-YYYY-MM-DD`
- One commit per updated service manifest (reviewers can navigate by commit)
- Final commit for flow + index updates (if Stage 4 ran)
- Open PR via git provider adapter
- Run schema validation on all changed files
- If validation passes and `pr_auto_merge: true`: merge automatically
- Call notification hook with run summary regardless of outcome

### Periodic Full Re-discover

Same pipeline, but Stage 2 is skipped -- Stage 3 re-discovers the entire codebase for all tracked repos regardless of diffs. Triggered when the time since the last full re-discover exceeds `full_rediscover_interval`.

The last full re-discover timestamp is tracked as a lightweight marker in the knowledge base (e.g., a git tag `documentator/full-rediscover-YYYY-MM-DD` or a `.documentator-state` file).

---

## Component 3: Discover Skill Changes

The existing `/discover` skill gains a `--headless` mode:

- **Skips interactive prompts.** No "discover all or filter?" question. Processes what it's told.
- **Skips human review.** Writes output directly.
- **Accepts `--scope` parameter.** Limits discovery to specific sections: `--scope "POST /orders, GET /orders/:id, data_models.Order"`. Only traces those code paths. The rest of the manifest is left untouched.
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
- Stage 4 (link) is skipped to prevent inconsistent flows

### Whole-run Failures

If the pipeline itself fails (can't clone, Bedrock auth fails, disk full):
- The notification hook is still called with the error
- No PR is created
- Next run retries everything

### Run Summary Format

```json
{
  "date": "2026-03-26",
  "services_tracked": 15,
  "services_changed": 3,
  "services_updated": 2,
  "services_failed": [
    {"name": "comms-service", "error": "Claude timeout after 120s"}
  ],
  "flows_relinked": false,
  "full_rediscover": false,
  "next_full_rediscover": "2026-04-02",
  "pr_url": "https://github.com/company/knowledge-base/pull/42",
  "pr_merged": false
}
```

---

## CI Wrapper Examples

### GitHub Actions

```yaml
# .github/workflows/documentator-nightly.yml
name: Documentator Nightly Update
on:
  schedule:
    - cron: '0 2 * * *'  # 2am daily
  workflow_dispatch: {}   # manual trigger

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
          # Bedrock auth via IAM role on the runner
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
          # Scheduled via Bitbucket Schedules UI
```

---

## Schema Changes

### Service Manifest

No breaking changes. The `discovered` timestamp is already in the schema and serves as the "last updated" marker for triage.

### Index

No changes required.

### New: documentator.config.yaml

Not validated by JSON Schema (it's tooling config, not knowledge base content). Validated by the script at startup with clear error messages for missing/invalid fields.

---

## Success Criteria

The nightly pipeline is successful if:

1. On a nightly run with 3 out of 15 repos changed, only those 3 repos are re-discovered (not all 15)
2. For a 200-endpoint service where 2 endpoints changed, only those 2 code paths are re-analyzed (not all 200)
3. Manifests produced by targeted re-discover are equivalent to what a full re-discover would produce for the affected sections
4. A partial failure (1 of 3 repos fails) still produces a PR with the 2 successful updates and does not corrupt flows
5. The pipeline works with both GitHub and Bitbucket without code changes (only CI config and env vars differ)
6. A weekly full re-discover catches any drift missed by the nightly triage

## Open Questions

1. **State tracking mechanism.** Git tag vs file in repo for tracking `last_full_rediscover`. Tags are cleaner (no file noise) but less visible. Leaning toward a `.documentator-state.json` file committed to the repo for transparency.
2. **Concurrency.** If a previous nightly PR is still open (not yet merged), should the next run update that PR or create a new one? Leaning toward updating the existing branch/PR to avoid PR pile-up.
3. **Rate limiting.** With 15 repos, Stage 3 makes up to 15 concurrent LLM calls. Should these be parallelized (fast, higher cost spike) or sequential (slower, smoother cost)? Likely configurable.
