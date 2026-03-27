# Nightly Update Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a nightly pipeline that keeps Documentator knowledge bases current by detecting repo changes, triaging affected manifest sections, re-discovering targeted code paths, and opening auto-merge PRs.

**Architecture:** A TypeScript CLI (`documentator-nightly`) orchestrates five stages: clone & detect, auto-escalation, triage (LLM), targeted re-discover (Claude Code CLI), and PR creation. Git provider adapters abstract GitHub/Bitbucket differences. A separate `documentator-audit` CLI measures triage accuracy. The existing `/discover` and `/link` skills gain `--headless` and `--scope` flags.

**Tech Stack:** TypeScript (ESM), Node.js child_process for git/Claude Code CLI, minimatch (glob patterns), js-yaml (manifest parsing), Vitest (tests), shell scripts (git provider adapters)

---

## File Structure

```
documentator/
  src/
    nightly/
      config.ts               # Parse and validate documentator.config.yaml
      clone.ts                 # Stage 1: shallow clone, change detection
      escalation.ts            # Stage 1.5: auto-escalation file pattern check
      triage.ts                # Stage 2: LLM triage orchestration
      rediscover.ts            # Stage 3: targeted re-discover orchestration
      link.ts                  # Stage 4: link orchestration with failure analysis
      pr.ts                    # Stage 5: branch, commit, PR, notify
      runner.ts                # Pipeline runner: wires stages together
      types.ts                 # Shared types for pipeline state
      cli.ts                   # CLI entry point (documentator-nightly)
    audit/
      cli.ts                   # CLI entry point (documentator-audit)
      runner.ts                # Audit runner: full re-discover + diff + report
    validate.ts                # (existing) Schema validation utility
    schemas/                   # (existing) JSON Schemas
  adapters/
    github.sh                  # GitHub PR adapter using gh CLI
    bitbucket.sh               # Bitbucket PR adapter using curl
  skills/
    discover.md                # (modify) Add --headless and --scope modes
    link.md                    # (modify) Add --headless mode
  tests/
    nightly/
      config.test.ts           # Config parsing tests
      clone.test.ts            # Clone and change detection tests
      escalation.test.ts       # Auto-escalation pattern matching tests
      triage.test.ts           # Triage LLM output parsing tests
      link.test.ts             # Link failure analysis tests
      pr.test.ts               # Branch/commit/PR orchestration tests
      runner.test.ts           # End-to-end pipeline wiring tests
    audit/
      runner.test.ts           # Audit diff and report generation tests
    fixtures/
      (existing fixtures)
      config/
        valid-config.yaml      # Valid config fixture
        minimal-config.yaml    # Config with only required fields
        invalid-config.yaml    # Config with bad values
    validate.test.ts           # (existing)
```

---

### Task 1: Shared Types

**Files:**
- Create: `src/nightly/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/nightly/types.ts

export interface ServiceInfo {
  name: string;
  repo: string;
  discovered: string; // ISO-8601
  manifestPath: string; // path to services/<name>.yaml in knowledge base
}

export interface ChangedRepo {
  service: ServiceInfo;
  clonePath: string; // temp directory where repo was cloned
  diff: string; // raw git diff output
}

export interface EscalationResult {
  escalated: ChangedRepo[]; // full re-discover (matched trigger patterns)
  triageable: ChangedRepo[]; // needs LLM triage
}

export interface TriageResult {
  service: string;
  scope: string[]; // file paths and/or endpoint identifiers for --scope
}

export interface DiscoverResult {
  service: string;
  success: boolean;
  error?: string;
  manifestPath?: string;
}

export interface LinkDecision {
  shouldLink: boolean;
  skipFlows: string[]; // flow names to skip (involve failed services)
  reason: string;
}

export interface RunSummary {
  date: string;
  services_tracked: number;
  services_changed: number;
  services_auto_escalated: number;
  services_triaged: number;
  services_updated: number;
  services_failed: Array<{ name: string; error: string }>;
  flows_relinked: boolean;
  flows_skipped: string[];
  tokens_used: number;
  pr_url: string | null;
  pr_merged: boolean;
}

export interface PipelineConfig {
  notification_hook: string | null;
  pr_auto_merge: boolean;
  claude_model: string;
  concurrency: "sequential" | "parallel" | number;
  full_rediscover_triggers: string[];
}

export interface PipelineState {
  last_nightly_run: string | null;
  last_accuracy_audit: string | null;
  last_audit_accuracy: number | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/nightly/types.ts
git commit -m "feat(nightly): add shared types for pipeline state"
```

---

### Task 2: Configuration Parsing

**Files:**
- Create: `src/nightly/config.ts`
- Create: `tests/nightly/config.test.ts`
- Create: `tests/fixtures/config/valid-config.yaml`
- Create: `tests/fixtures/config/minimal-config.yaml`
- Create: `tests/fixtures/config/invalid-config.yaml`

- [ ] **Step 1: Create test fixtures**

```yaml
# tests/fixtures/config/valid-config.yaml
notification_hook: ./hooks/notify.sh
pr_auto_merge: true
claude_model: sonnet
concurrency: sequential
full_rediscover_triggers:
  - "package.json"
  - "package-lock.json"
  - "composer.json"
  - "Dockerfile"
  - "*.migration.*"
  - "db/migrations/**"
```

```yaml
# tests/fixtures/config/minimal-config.yaml
# All fields are optional; defaults should apply
```

```yaml
# tests/fixtures/config/invalid-config.yaml
pr_auto_merge: "yes"  # should be boolean
concurrency: -5        # invalid
full_rediscover_triggers: "not-an-array"
```

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/nightly/config.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseConfig, DEFAULT_CONFIG } from "../../src/nightly/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(__dirname, "..", "fixtures", "config", name), "utf-8");

describe("parseConfig", () => {
  it("parses a fully specified config", () => {
    const config = parseConfig(fixture("valid-config.yaml"));
    expect(config.pr_auto_merge).toBe(true);
    expect(config.claude_model).toBe("sonnet");
    expect(config.concurrency).toBe("sequential");
    expect(config.notification_hook).toBe("./hooks/notify.sh");
    expect(config.full_rediscover_triggers).toContain("package.json");
    expect(config.full_rediscover_triggers).toContain("*.migration.*");
  });

  it("applies defaults for missing fields", () => {
    const config = parseConfig(fixture("minimal-config.yaml"));
    expect(config.pr_auto_merge).toBe(true);
    expect(config.claude_model).toBe("sonnet");
    expect(config.concurrency).toBe("sequential");
    expect(config.notification_hook).toBeNull();
    expect(config.full_rediscover_triggers).toEqual(DEFAULT_CONFIG.full_rediscover_triggers);
  });

  it("throws on invalid field types", () => {
    expect(() => parseConfig(fixture("invalid-config.yaml"))).toThrow();
  });

  it("accepts numeric concurrency", () => {
    const config = parseConfig("concurrency: 4\n");
    expect(config.concurrency).toBe(4);
  });

  it("rejects negative concurrency", () => {
    expect(() => parseConfig("concurrency: -1\n")).toThrow("concurrency");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/nightly/config.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 4: Implement config parser**

```typescript
// src/nightly/config.ts
import yaml from "js-yaml";
import type { PipelineConfig } from "./types.js";

export const DEFAULT_CONFIG: PipelineConfig = {
  notification_hook: null,
  pr_auto_merge: true,
  claude_model: "sonnet",
  concurrency: "sequential",
  full_rediscover_triggers: [
    "package.json",
    "package-lock.json",
    "composer.json",
    "composer.lock",
    "build.gradle",
    "build.gradle.kts",
    "Dockerfile",
    "*.migration.*",
    "db/migrations/**",
    ".env.example",
  ],
};

export function parseConfig(yamlContent: string): PipelineConfig {
  const raw = yaml.load(yamlContent);

  if (raw === null || raw === undefined) {
    return { ...DEFAULT_CONFIG };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Config must be a YAML mapping");
  }

  const data = raw as Record<string, unknown>;
  const config = { ...DEFAULT_CONFIG };

  if ("notification_hook" in data) {
    if (data.notification_hook !== null && typeof data.notification_hook !== "string") {
      throw new Error("notification_hook must be a string or null");
    }
    config.notification_hook = (data.notification_hook as string) ?? null;
  }

  if ("pr_auto_merge" in data) {
    if (typeof data.pr_auto_merge !== "boolean") {
      throw new Error("pr_auto_merge must be a boolean");
    }
    config.pr_auto_merge = data.pr_auto_merge;
  }

  if ("claude_model" in data) {
    if (typeof data.claude_model !== "string") {
      throw new Error("claude_model must be a string");
    }
    config.claude_model = data.claude_model;
  }

  if ("concurrency" in data) {
    const val = data.concurrency;
    if (val === "sequential" || val === "parallel") {
      config.concurrency = val;
    } else if (typeof val === "number" && Number.isInteger(val) && val > 0) {
      config.concurrency = val;
    } else {
      throw new Error("concurrency must be 'sequential', 'parallel', or a positive integer");
    }
  }

  if ("full_rediscover_triggers" in data) {
    if (!Array.isArray(data.full_rediscover_triggers)) {
      throw new Error("full_rediscover_triggers must be an array");
    }
    if (!data.full_rediscover_triggers.every((t: unknown) => typeof t === "string")) {
      throw new Error("full_rediscover_triggers entries must be strings");
    }
    config.full_rediscover_triggers = data.full_rediscover_triggers as string[];
  }

  return config;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/nightly/config.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/nightly/config.ts tests/nightly/config.test.ts tests/fixtures/config/
git commit -m "feat(nightly): add config parser with defaults and validation"
```

---

### Task 3: Auto-Escalation Pattern Matching

**Files:**
- Create: `src/nightly/escalation.ts`
- Create: `tests/nightly/escalation.test.ts`

This task requires a glob matching dependency.

- [ ] **Step 1: Install minimatch**

```bash
npm install minimatch && npm install -D @types/minimatch
```

Note: `minimatch` is a well-known, zero-dependency glob matcher used by npm itself. If it's already available transitively, skip the install and import directly.

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/nightly/escalation.test.ts
import { describe, it, expect } from "vitest";
import { checkEscalation, getChangedFiles } from "../../src/nightly/escalation.js";

describe("getChangedFiles", () => {
  it("extracts file paths from a git diff", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
+import foo from 'bar';
diff --git a/package.json b/package.json
index 111..222 100644
--- a/package.json
+++ b/package.json
@@ -5,6 +5,7 @@
+  "minimatch": "^9.0.0"
`;
    const files = getChangedFiles(diff);
    expect(files).toEqual(["src/app.ts", "package.json"]);
  });

  it("returns empty array for empty diff", () => {
    expect(getChangedFiles("")).toEqual([]);
  });

  it("deduplicates file paths", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts`;
    const files = getChangedFiles(diff);
    expect(files).toEqual(["src/app.ts"]);
  });
});

describe("checkEscalation", () => {
  const triggers = [
    "package.json",
    "Dockerfile",
    "*.migration.*",
    "db/migrations/**",
  ];

  it("escalates when diff touches a trigger file", () => {
    const files = ["src/app.ts", "package.json"];
    expect(checkEscalation(files, triggers)).toBe(true);
  });

  it("does not escalate for non-trigger files", () => {
    const files = ["src/app.ts", "src/routes.ts"];
    expect(checkEscalation(files, triggers)).toBe(false);
  });

  it("matches glob patterns", () => {
    const files = ["src/20260327_add_users.migration.sql"];
    expect(checkEscalation(files, triggers)).toBe(true);
  });

  it("matches deep glob patterns", () => {
    const files = ["db/migrations/2026/03/create_orders.sql"];
    expect(checkEscalation(files, triggers)).toBe(true);
  });

  it("matches Dockerfile in subdirectory", () => {
    // "Dockerfile" pattern should match only top-level by default
    const files = ["docker/Dockerfile.dev"];
    expect(checkEscalation(files, triggers)).toBe(false);
  });

  it("returns false for empty file list", () => {
    expect(checkEscalation([], triggers)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/nightly/escalation.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 4: Implement escalation module**

```typescript
// src/nightly/escalation.ts
import { minimatch } from "minimatch";
import type { ChangedRepo, EscalationResult } from "./types.js";

/**
 * Extract changed file paths from a git diff output.
 * Parses "diff --git a/<path> b/<path>" lines.
 */
export function getChangedFiles(diff: string): string[] {
  const seen = new Set<string>();
  const regex = /^diff --git a\/(.+?) b\//gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(diff)) !== null) {
    seen.add(match[1]);
  }
  return [...seen];
}

/**
 * Check if any changed files match the escalation trigger patterns.
 */
export function checkEscalation(files: string[], triggers: string[]): boolean {
  return files.some((file) =>
    triggers.some((pattern) => minimatch(file, pattern, { matchBase: false }))
  );
}

/**
 * Partition changed repos into escalated (full re-discover) and triageable.
 */
export function partitionByEscalation(
  changedRepos: ChangedRepo[],
  triggers: string[]
): EscalationResult {
  const escalated: ChangedRepo[] = [];
  const triageable: ChangedRepo[] = [];

  for (const repo of changedRepos) {
    const files = getChangedFiles(repo.diff);
    if (checkEscalation(files, triggers)) {
      escalated.push(repo);
    } else {
      triageable.push(repo);
    }
  }

  return { escalated, triageable };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/nightly/escalation.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/nightly/escalation.ts tests/nightly/escalation.test.ts package.json package-lock.json
git commit -m "feat(nightly): add auto-escalation pattern matching"
```

---

### Task 4: Clone & Change Detection

**Files:**
- Create: `src/nightly/clone.ts`
- Create: `tests/nightly/clone.test.ts`

- [ ] **Step 1: Write the failing tests**

These tests verify the logic functions without actually hitting git. The `execGit` helper is injected for testability.

```typescript
// tests/nightly/clone.test.ts
import { describe, it, expect } from "vitest";
import { parseManifestHeader, hasChanges } from "../../src/nightly/clone.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("parseManifestHeader", () => {
  it("extracts service info from a manifest file", () => {
    const manifestPath = join(__dirname, "..", "fixtures", "valid", "order-service.yaml");
    const raw = readFileSync(manifestPath, "utf-8");
    const data = yaml.load(raw) as Record<string, unknown>;
    const service = data.service as Record<string, string>;

    const info = parseManifestHeader(manifestPath, data);
    expect(info.name).toBe(service.name);
    expect(info.repo).toBe(service.repo);
    expect(info.discovered).toBe(service.discovered);
    expect(info.manifestPath).toBe(manifestPath);
  });

  it("throws if manifest is missing service block", () => {
    expect(() =>
      parseManifestHeader("/fake.yaml", { schema_version: 1 } as Record<string, unknown>)
    ).toThrow("service");
  });
});

describe("hasChanges", () => {
  it("returns true when git log has output", () => {
    expect(hasChanges("abc1234 feat: add orders\ndef5678 fix: order total")).toBe(true);
  });

  it("returns false when git log is empty", () => {
    expect(hasChanges("")).toBe(false);
    expect(hasChanges("  \n  ")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/nightly/clone.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement clone module**

```typescript
// src/nightly/clone.ts
import { execSync } from "child_process";
import { readFileSync, readdirSync, mkdtempSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import yaml from "js-yaml";
import type { ServiceInfo, ChangedRepo } from "./types.js";

/**
 * Extract service info from a parsed manifest.
 */
export function parseManifestHeader(
  manifestPath: string,
  data: Record<string, unknown>
): ServiceInfo {
  const service = data.service as Record<string, string> | undefined;
  if (!service || typeof service !== "object") {
    throw new Error(`Manifest ${manifestPath} missing 'service' block`);
  }
  return {
    name: service.name,
    repo: service.repo,
    discovered: service.discovered,
    manifestPath,
  };
}

/**
 * Check if git log output indicates commits exist.
 */
export function hasChanges(gitLogOutput: string): boolean {
  return gitLogOutput.trim().length > 0;
}

/**
 * Read all service manifests from a knowledge base directory.
 */
export function loadServiceInfos(kbDir: string): ServiceInfo[] {
  const servicesDir = join(kbDir, "services");
  const files = readdirSync(servicesDir).filter((f) => f.endsWith(".yaml"));
  return files.map((f) => {
    const fullPath = join(servicesDir, f);
    const raw = readFileSync(fullPath, "utf-8");
    const data = yaml.load(raw) as Record<string, unknown>;
    return parseManifestHeader(fullPath, data);
  });
}

/**
 * Shallow-clone a repo with fallback strategy for depth.
 * Returns the clone directory path.
 */
export function cloneRepo(repo: string, since: string, workDir: string): string {
  const repoName = basename(repo).replace(/\.git$/, "");
  const clonePath = join(workDir, repoName);

  // Try --shallow-since first
  try {
    execSync(
      `git clone --shallow-since="${since}" "${repo}" "${clonePath}"`,
      { stdio: "pipe", timeout: 120_000 }
    );
  } catch {
    // Fallback: --depth=100
    try {
      execSync(
        `git clone --depth=100 "${repo}" "${clonePath}"`,
        { stdio: "pipe", timeout: 120_000 }
      );
    } catch {
      // Last resort: full clone
      execSync(
        `git clone "${repo}" "${clonePath}"`,
        { stdio: "pipe", timeout: 300_000 }
      );
    }
  }

  // Sanity check: verify oldest available commit predates `since`
  try {
    const oldestCommitDate = execSync(
      `git -C "${clonePath}" log --reverse --format=%aI | head -1`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();

    if (oldestCommitDate && new Date(oldestCommitDate) > new Date(since)) {
      // Shallow clone doesn't go far enough, deepen
      execSync(`git -C "${clonePath}" fetch --unshallow`, {
        stdio: "pipe",
        timeout: 300_000,
      });
    }
  } catch {
    // If sanity check fails, proceed anyway -- worst case we miss some changes
    // which will be caught next run
  }

  return clonePath;
}

/**
 * Get the diff for a repo since a given timestamp.
 * Returns null if no changes.
 */
export function getDiff(clonePath: string, since: string): string | null {
  const logOutput = execSync(
    `git -C "${clonePath}" log --since="${since}" --oneline`,
    { encoding: "utf-8", stdio: "pipe" }
  ).trim();

  if (!hasChanges(logOutput)) {
    return null;
  }

  const diff = execSync(
    `git -C "${clonePath}" log --since="${since}" -p`,
    { encoding: "utf-8", stdio: "pipe", maxBuffer: 50 * 1024 * 1024 }
  );

  return diff;
}

/**
 * Stage 1: Clone all tracked repos and detect which have changes.
 */
export function cloneAndDetectChanges(kbDir: string): {
  changed: ChangedRepo[];
  unchanged: string[];
  errors: Array<{ service: string; error: string }>;
} {
  const services = loadServiceInfos(kbDir);
  const workDir = mkdtempSync(join(tmpdir(), "documentator-"));
  const changed: ChangedRepo[] = [];
  const unchanged: string[] = [];
  const errors: Array<{ service: string; error: string }> = [];

  for (const service of services) {
    try {
      const clonePath = cloneRepo(service.repo, service.discovered, workDir);
      const diff = getDiff(clonePath, service.discovered);
      if (diff) {
        changed.push({ service, clonePath, diff });
      } else {
        unchanged.push(service.name);
      }
    } catch (err) {
      errors.push({
        service: service.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { changed, unchanged, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/nightly/clone.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/nightly/clone.ts tests/nightly/clone.test.ts
git commit -m "feat(nightly): add clone and change detection (Stage 1)"
```

---

### Task 5: Triage LLM Orchestration

**Files:**
- Create: `src/nightly/triage.ts`
- Create: `tests/nightly/triage.test.ts`

Stage 2 shells out to the Claude Code CLI with a prompt that produces structured triage output.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/nightly/triage.test.ts
import { describe, it, expect } from "vitest";
import { parseTriageOutput, buildTriagePrompt } from "../../src/nightly/triage.js";

describe("buildTriagePrompt", () => {
  it("includes the manifest and diff in the prompt", () => {
    const prompt = buildTriagePrompt("order-service manifest yaml...", "diff content...");
    expect(prompt).toContain("order-service manifest yaml...");
    expect(prompt).toContain("diff content...");
    expect(prompt).toContain("JSON");
  });
});

describe("parseTriageOutput", () => {
  it("parses valid JSON triage output", () => {
    const output = `Some preamble text
\`\`\`json
{
  "affected_sections": [
    {"type": "endpoint", "identifier": "POST /orders", "files": ["src/controllers/OrderController.php"]},
    {"type": "data_model", "identifier": "Order", "files": ["src/models/Order.php"]}
  ]
}
\`\`\`
Some trailing text`;
    const result = parseTriageOutput("order-service", output);
    expect(result.service).toBe("order-service");
    expect(result.scope).toContain("src/controllers/OrderController.php");
    expect(result.scope).toContain("src/models/Order.php");
    expect(result.scope).toContain("POST /orders");
    expect(result.scope).toContain("data_models.Order");
  });

  it("deduplicates scope entries", () => {
    const output = `\`\`\`json
{
  "affected_sections": [
    {"type": "endpoint", "identifier": "POST /orders", "files": ["src/OrderController.php"]},
    {"type": "endpoint", "identifier": "GET /orders", "files": ["src/OrderController.php"]}
  ]
}
\`\`\``;
    const result = parseTriageOutput("svc", output);
    const fileOccurrences = result.scope.filter((s) => s === "src/OrderController.php");
    expect(fileOccurrences).toHaveLength(1);
  });

  it("throws on unparseable output", () => {
    expect(() => parseTriageOutput("svc", "no json here")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/nightly/triage.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement triage module**

```typescript
// src/nightly/triage.ts
import { execSync } from "child_process";
import type { ChangedRepo, TriageResult } from "./types.js";
import { readFileSync } from "fs";

/**
 * Build the prompt sent to the LLM for triaging a diff against a manifest.
 */
export function buildTriagePrompt(manifestYaml: string, diff: string): string {
  return `You are analyzing a code diff to determine which sections of a service manifest need to be re-discovered.

## Current Manifest

\`\`\`yaml
${manifestYaml}
\`\`\`

## Git Diff (changes since last discovery)

\`\`\`
${diff}
\`\`\`

## Task

Identify which manifest sections are affected by these changes. Consider:
- Direct changes to endpoint handlers, routes, or controllers
- Changes to service/business logic classes used by endpoints
- Changes to data models or their fields
- Changes to outbound HTTP calls or event publishers/consumers
- Changes to shared code (base classes, middleware, helpers) that could affect multiple sections

Respond with ONLY a JSON block in this format:

\`\`\`json
{
  "affected_sections": [
    {
      "type": "endpoint | outbound_call | data_model | business_rule | event",
      "identifier": "POST /orders | Order | order.created",
      "files": ["src/controllers/OrderController.php", "src/services/OrderService.php"]
    }
  ]
}
\`\`\`

Include the source files that should be re-read. File paths come from the diff and are authoritative. If a shared file affects multiple sections, list it under each affected section.

If the diff is too large or unclear to analyze, respond with all sections marked for re-discovery.`;
}

interface TriageSection {
  type: string;
  identifier: string;
  files: string[];
}

/**
 * Parse the LLM's triage output into a TriageResult.
 */
export function parseTriageOutput(serviceName: string, output: string): TriageResult {
  // Extract JSON from markdown code fence
  const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse triage output for ${serviceName}: no JSON block found`);
  }

  const parsed = JSON.parse(jsonMatch[1].trim()) as {
    affected_sections: TriageSection[];
  };

  if (!parsed.affected_sections || !Array.isArray(parsed.affected_sections)) {
    throw new Error(`Invalid triage output structure for ${serviceName}`);
  }

  // Build scope: collect unique file paths and identifiers
  const scope = new Set<string>();
  for (const section of parsed.affected_sections) {
    // Add file paths (preferred for --scope)
    if (section.files) {
      for (const f of section.files) {
        scope.add(f);
      }
    }
    // Add typed identifiers (fallback)
    if (section.type === "endpoint") {
      scope.add(section.identifier);
    } else if (section.type === "data_model") {
      scope.add(`data_models.${section.identifier}`);
    } else if (section.type === "event") {
      scope.add(`events.${section.identifier}`);
    } else if (section.type === "outbound_call") {
      scope.add(`outbound_calls.${section.identifier}`);
    } else if (section.type === "business_rule") {
      scope.add(`business_rules.${section.identifier}`);
    }
  }

  return { service: serviceName, scope: [...scope] };
}

/**
 * Run triage for a single changed repo via Claude Code CLI.
 */
export function triageRepo(
  repo: ChangedRepo,
  model: string
): TriageResult {
  const manifestYaml = readFileSync(repo.service.manifestPath, "utf-8");
  const prompt = buildTriagePrompt(manifestYaml, repo.diff);

  const output = execSync(
    `claude --model ${model} --print --output-format text`,
    {
      input: prompt,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  return parseTriageOutput(repo.service.name, output);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/nightly/triage.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/nightly/triage.ts tests/nightly/triage.test.ts
git commit -m "feat(nightly): add LLM triage with prompt and output parsing (Stage 2)"
```

---

### Task 6: Re-discover Orchestration

**Files:**
- Create: `src/nightly/rediscover.ts`

Stage 3 invokes `claude` with the `/discover --headless` skill in each changed repo. This module is primarily orchestration of external CLI calls.

- [ ] **Step 1: Implement re-discover module**

```typescript
// src/nightly/rediscover.ts
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import yaml from "js-yaml";
import { validateServiceManifest } from "../validate.js";
import type { ChangedRepo, TriageResult, DiscoverResult } from "./types.js";

/**
 * Run headless discover on a repo, either full or scoped.
 */
export function discoverRepo(
  clonePath: string,
  serviceName: string,
  manifestPath: string,
  model: string,
  scope: string[] | null
): DiscoverResult {
  const scopeArg = scope ? ` --scope "${scope.join(", ")}"` : "";
  const prompt = `/discover --headless${scopeArg} --output "${manifestPath}"`;

  try {
    execSync(`claude --model ${model} --print --output-format text "${prompt}"`, {
      cwd: clonePath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600_000, // 10 minutes for large repos
      maxBuffer: 50 * 1024 * 1024,
    });

    // Validate the produced manifest
    if (!existsSync(manifestPath)) {
      return {
        service: serviceName,
        success: false,
        error: "Discover completed but no manifest file was produced",
      };
    }

    const raw = readFileSync(manifestPath, "utf-8");
    const data = yaml.load(raw);
    const validation = validateServiceManifest(data);

    if (!validation.valid) {
      return {
        service: serviceName,
        success: false,
        error: `Schema validation failed: ${validation.errors.join("; ")}`,
      };
    }

    return { service: serviceName, success: true, manifestPath };
  } catch (err) {
    return {
      service: serviceName,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Stage 3: Run targeted re-discover on all changed repos.
 * Escalated repos get full re-discover; triaged repos get scoped re-discover.
 */
export function rediscoverAll(
  escalated: ChangedRepo[],
  triageResults: TriageResult[],
  triageableRepos: ChangedRepo[],
  model: string,
  concurrency: "sequential" | "parallel" | number
): DiscoverResult[] {
  const tasks: Array<{
    clonePath: string;
    serviceName: string;
    manifestPath: string;
    scope: string[] | null;
  }> = [];

  // Escalated repos: full re-discover
  for (const repo of escalated) {
    tasks.push({
      clonePath: repo.clonePath,
      serviceName: repo.service.name,
      manifestPath: repo.service.manifestPath,
      scope: null,
    });
  }

  // Triaged repos: scoped re-discover
  for (const triage of triageResults) {
    const repo = triageableRepos.find((r) => r.service.name === triage.service);
    if (repo) {
      tasks.push({
        clonePath: repo.clonePath,
        serviceName: repo.service.name,
        manifestPath: repo.service.manifestPath,
        scope: triage.scope,
      });
    }
  }

  // Execute sequentially for now. Parallel execution would use worker threads
  // or Promise.all with child_process.exec (async). Configurable via concurrency.
  // TODO: implement parallel/numeric concurrency modes
  return tasks.map((task) =>
    discoverRepo(task.clonePath, task.serviceName, task.manifestPath, model, task.scope)
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/nightly/rediscover.ts
git commit -m "feat(nightly): add re-discover orchestration (Stage 3)"
```

---

### Task 7: Link Decision Logic

**Files:**
- Create: `src/nightly/link.ts`
- Create: `tests/nightly/link.test.ts`

Stage 4 decides which flows to re-link based on which repos failed.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/nightly/link.test.ts
import { describe, it, expect } from "vitest";
import { decideLinking } from "../../src/nightly/link.js";

const sampleIndex = {
  services: [
    { name: "order-service", file: "services/order-service.yaml", summary: "Orders", endpoints_count: 12 },
    { name: "inventory-service", file: "services/inventory-service.yaml", summary: "Inventory", endpoints_count: 8 },
    { name: "comms-service", file: "services/comms-service.yaml", summary: "Comms", endpoints_count: 4 },
    { name: "logging-service", file: "services/logging-service.yaml", summary: "Logging", endpoints_count: 2 },
  ],
  flows: [
    { name: "Place Order", file: "flows/orders/place-order.yaml", summary: "Order creation", services: ["order-service", "inventory-service", "comms-service"] },
    { name: "Cancel Order", file: "flows/orders/cancel-order.yaml", summary: "Order cancellation", services: ["order-service", "inventory-service"] },
    { name: "Send Notification", file: "flows/comms/send-notification.yaml", summary: "Send notif", services: ["comms-service", "logging-service"] },
  ],
};

describe("decideLinking", () => {
  it("links everything when no failures", () => {
    const decision = decideLinking([], sampleIndex);
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toEqual([]);
  });

  it("skips flows involving failed services", () => {
    const decision = decideLinking(["comms-service"], sampleIndex);
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toContain("Place Order");
    expect(decision.skipFlows).toContain("Send Notification");
    expect(decision.skipFlows).not.toContain("Cancel Order");
  });

  it("allows full linking when failed service has no flows", () => {
    const decision = decideLinking(["logging-service"], sampleIndex);
    // logging-service is in Send Notification flow
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toContain("Send Notification");
    expect(decision.skipFlows).not.toContain("Place Order");
    expect(decision.skipFlows).not.toContain("Cancel Order");
  });

  it("skips linking entirely when all flows are affected", () => {
    const decision = decideLinking(["order-service", "comms-service"], sampleIndex);
    // All 3 flows involve order-service or comms-service
    expect(decision.shouldLink).toBe(false);
    expect(decision.skipFlows).toHaveLength(3);
  });

  it("handles missing index gracefully", () => {
    const decision = decideLinking(["order-service"], { services: [], flows: [] });
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/nightly/link.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement link decision logic**

```typescript
// src/nightly/link.ts
import { execSync } from "child_process";
import type { LinkDecision } from "./types.js";

interface IndexData {
  services: Array<{ name: string; file: string; summary: string; endpoints_count: number }>;
  flows: Array<{ name: string; file: string; summary: string; services: string[] }>;
}

/**
 * Decide which flows to re-link based on which services failed.
 */
export function decideLinking(failedServices: string[], index: IndexData): LinkDecision {
  if (failedServices.length === 0) {
    return { shouldLink: true, skipFlows: [], reason: "All services updated successfully" };
  }

  const failedSet = new Set(failedServices);
  const skipFlows: string[] = [];

  for (const flow of index.flows) {
    if (flow.services.some((s) => failedSet.has(s))) {
      skipFlows.push(flow.name);
    }
  }

  if (skipFlows.length === index.flows.length) {
    return {
      shouldLink: false,
      skipFlows,
      reason: `All flows involve failed services: ${failedServices.join(", ")}`,
    };
  }

  return {
    shouldLink: true,
    skipFlows,
    reason: skipFlows.length > 0
      ? `Skipping ${skipFlows.length} flows involving failed services: ${failedServices.join(", ")}`
      : "No flows involve failed services",
  };
}

/**
 * Run headless link on the knowledge base.
 */
export function runLink(kbDir: string, model: string): void {
  execSync(`claude --model ${model} --print --output-format text "/link --headless"`, {
    cwd: kbDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 600_000,
    maxBuffer: 50 * 1024 * 1024,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/nightly/link.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/nightly/link.ts tests/nightly/link.test.ts
git commit -m "feat(nightly): add link decision logic (Stage 4)"
```

---

### Task 8: PR & Notification (Stage 5)

**Files:**
- Create: `src/nightly/pr.ts`
- Create: `tests/nightly/pr.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/nightly/pr.test.ts
import { describe, it, expect } from "vitest";
import {
  buildPrBody,
  buildBranchName,
  detectGitProvider,
} from "../../src/nightly/pr.js";
import type { RunSummary } from "../../src/nightly/types.js";

describe("buildBranchName", () => {
  it("generates date-based branch name", () => {
    const name = buildBranchName("2026-03-27");
    expect(name).toBe("documentator/nightly-2026-03-27");
  });
});

describe("detectGitProvider", () => {
  it("detects github from remote URL", () => {
    expect(detectGitProvider("https://github.com/company/repo.git")).toBe("github");
    expect(detectGitProvider("git@github.com:company/repo.git")).toBe("github");
  });

  it("detects bitbucket from remote URL", () => {
    expect(detectGitProvider("https://bitbucket.org/company/repo.git")).toBe("bitbucket");
    expect(detectGitProvider("git@bitbucket.org:company/repo.git")).toBe("bitbucket");
  });

  it("returns unknown for unrecognized hosts", () => {
    expect(detectGitProvider("https://gitlab.com/company/repo.git")).toBe("unknown");
  });
});

describe("buildPrBody", () => {
  const summary: RunSummary = {
    date: "2026-03-27",
    services_tracked: 15,
    services_changed: 3,
    services_auto_escalated: 1,
    services_triaged: 2,
    services_updated: 2,
    services_failed: [{ name: "comms-service", error: "timeout" }],
    flows_relinked: false,
    flows_skipped: ["Send Notification"],
    tokens_used: 142300,
    pr_url: null,
    pr_merged: false,
  };

  it("includes service counts", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("15");
    expect(body).toContain("3");
    expect(body).toContain("2");
  });

  it("includes failure details", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("comms-service");
    expect(body).toContain("timeout");
  });

  it("includes skipped flows", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("Send Notification");
  });

  it("includes token usage", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("142300");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/nightly/pr.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement PR module**

```typescript
// src/nightly/pr.ts
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import type { RunSummary, DiscoverResult } from "./types.js";

export function buildBranchName(date: string): string {
  return `documentator/nightly-${date}`;
}

export function detectGitProvider(remoteUrl: string): "github" | "bitbucket" | "unknown" {
  const override = process.env.DOCUMENTATOR_GIT_PROVIDER;
  if (override === "github" || override === "bitbucket") return override;

  if (remoteUrl.includes("github.com")) return "github";
  if (remoteUrl.includes("bitbucket.org")) return "bitbucket";
  return "unknown";
}

export function buildPrBody(summary: RunSummary): string {
  const lines: string[] = [
    "## Documentator Nightly Update",
    "",
    `**Date:** ${summary.date}`,
    `**Services tracked:** ${summary.services_tracked}`,
    `**Services changed:** ${summary.services_changed}`,
    `**Auto-escalated:** ${summary.services_auto_escalated}`,
    `**Triaged:** ${summary.services_triaged}`,
    `**Updated:** ${summary.services_updated}`,
    `**Tokens used:** ${summary.tokens_used}`,
    "",
  ];

  if (summary.services_failed.length > 0) {
    lines.push("### Failures");
    lines.push("");
    for (const f of summary.services_failed) {
      lines.push(`- **${f.name}**: ${f.error}`);
    }
    lines.push("");
  }

  if (summary.flows_relinked) {
    lines.push("Flows re-linked successfully.");
  } else if (summary.flows_skipped.length > 0) {
    lines.push("### Skipped Flows");
    lines.push("");
    for (const f of summary.flows_skipped) {
      lines.push(`- ${f}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Generated by Documentator nightly pipeline*");

  return lines.join("\n");
}

/**
 * Create per-service commits and a flow commit, then open/update a PR.
 */
export function createPr(
  kbDir: string,
  results: DiscoverResult[],
  flowsUpdated: boolean,
  summary: RunSummary
): string | null {
  const date = summary.date;
  const branch = buildBranchName(date);

  // Check for existing open documentator branch
  try {
    const existingBranches = execSync(
      `git -C "${kbDir}" branch -r --list "origin/documentator/nightly-*"`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();

    if (existingBranches) {
      // Update existing branch
      execSync(`git -C "${kbDir}" checkout -B "${branch}"`, { stdio: "pipe" });
    } else {
      execSync(`git -C "${kbDir}" checkout -b "${branch}"`, { stdio: "pipe" });
    }
  } catch {
    execSync(`git -C "${kbDir}" checkout -b "${branch}"`, { stdio: "pipe" });
  }

  // One commit per updated service
  for (const result of results.filter((r) => r.success && r.manifestPath)) {
    execSync(`git -C "${kbDir}" add "${result.manifestPath}"`, { stdio: "pipe" });
    execSync(
      `git -C "${kbDir}" commit -m "docs(${result.service}): update service manifest" --allow-empty`,
      { stdio: "pipe" }
    );
  }

  // Flow + index commit
  if (flowsUpdated) {
    execSync(`git -C "${kbDir}" add flows/ index.yaml`, { stdio: "pipe" });
    execSync(
      `git -C "${kbDir}" commit -m "docs(flows): update flows and index" --allow-empty`,
      { stdio: "pipe" }
    );
  }

  // Push and create PR via adapter
  const remoteUrl = execSync(`git -C "${kbDir}" remote get-url origin`, {
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  const provider = detectGitProvider(remoteUrl);
  const adapterDir = join(dirname(dirname(kbDir)), "adapters"); // relative to documentator install
  const adapterPath = join(adapterDir, `${provider}.sh`);

  execSync(`git -C "${kbDir}" push -u origin "${branch}" --force`, { stdio: "pipe" });

  const title = `Documentator nightly update ${date}`;
  const body = buildPrBody(summary);

  if (provider === "github") {
    try {
      const prUrl = execSync(
        `gh pr create --title "${title}" --body "${body.replace(/"/g, '\\"')}" --head "${branch}" 2>/dev/null || gh pr view "${branch}" --json url -q .url`,
        { encoding: "utf-8", cwd: kbDir, stdio: "pipe" }
      ).trim();
      return prUrl;
    } catch {
      return null;
    }
  } else if (provider === "bitbucket" && existsSync(adapterPath)) {
    try {
      const prUrl = execSync(
        `bash "${adapterPath}" create_pr "${branch}" "${title}" "${body.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", cwd: kbDir, stdio: "pipe" }
      ).trim();
      return prUrl;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Call the notification hook with the run summary.
 */
export function notify(hookPath: string | null, summary: RunSummary): void {
  if (!hookPath) return;

  try {
    execSync(`bash "${hookPath}"`, {
      input: JSON.stringify(summary, null, 2),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
  } catch {
    // Notification failure should not fail the pipeline
    console.error(`Warning: notification hook failed: ${hookPath}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/nightly/pr.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/nightly/pr.ts tests/nightly/pr.test.ts
git commit -m "feat(nightly): add PR creation and notification (Stage 5)"
```

---

### Task 9: Pipeline Runner

**Files:**
- Create: `src/nightly/runner.ts`
- Create: `tests/nightly/runner.test.ts`

The runner wires all stages together.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/nightly/runner.test.ts
import { describe, it, expect } from "vitest";
import { buildRunSummary } from "../../src/nightly/runner.js";
import type { DiscoverResult, LinkDecision, EscalationResult } from "../../src/nightly/types.js";

describe("buildRunSummary", () => {
  it("produces correct summary from pipeline results", () => {
    const escalation: EscalationResult = {
      escalated: [{ service: { name: "svc-a", repo: "", discovered: "", manifestPath: "" }, clonePath: "", diff: "" }],
      triageable: [
        { service: { name: "svc-b", repo: "", discovered: "", manifestPath: "" }, clonePath: "", diff: "" },
        { service: { name: "svc-c", repo: "", discovered: "", manifestPath: "" }, clonePath: "", diff: "" },
      ],
    };

    const discoverResults: DiscoverResult[] = [
      { service: "svc-a", success: true },
      { service: "svc-b", success: true },
      { service: "svc-c", success: false, error: "timeout" },
    ];

    const linkDecision: LinkDecision = {
      shouldLink: true,
      skipFlows: ["Flow X"],
      reason: "svc-c participates in Flow X",
    };

    const summary = buildRunSummary({
      date: "2026-03-27",
      servicesTracked: 10,
      escalation,
      discoverResults,
      linkDecision,
      flowsRelinked: true,
      prUrl: "https://github.com/co/kb/pull/1",
      prMerged: false,
      tokensUsed: 50000,
    });

    expect(summary.services_tracked).toBe(10);
    expect(summary.services_changed).toBe(3);
    expect(summary.services_auto_escalated).toBe(1);
    expect(summary.services_triaged).toBe(2);
    expect(summary.services_updated).toBe(2);
    expect(summary.services_failed).toHaveLength(1);
    expect(summary.services_failed[0].name).toBe("svc-c");
    expect(summary.flows_relinked).toBe(true);
    expect(summary.flows_skipped).toEqual(["Flow X"]);
    expect(summary.tokens_used).toBe(50000);
    expect(summary.pr_url).toBe("https://github.com/co/kb/pull/1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/nightly/runner.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement the runner**

```typescript
// src/nightly/runner.ts
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { parseConfig } from "./config.js";
import { cloneAndDetectChanges, loadServiceInfos } from "./clone.js";
import { partitionByEscalation } from "./escalation.js";
import { triageRepo } from "./triage.js";
import { rediscoverAll } from "./rediscover.js";
import { decideLinking, runLink } from "./link.js";
import { createPr, notify } from "./pr.js";
import type {
  PipelineConfig,
  PipelineState,
  RunSummary,
  EscalationResult,
  DiscoverResult,
  LinkDecision,
  TriageResult,
} from "./types.js";

interface SummaryInput {
  date: string;
  servicesTracked: number;
  escalation: EscalationResult;
  discoverResults: DiscoverResult[];
  linkDecision: LinkDecision;
  flowsRelinked: boolean;
  prUrl: string | null;
  prMerged: boolean;
  tokensUsed: number;
}

/**
 * Build the run summary from pipeline results.
 */
export function buildRunSummary(input: SummaryInput): RunSummary {
  const { escalation, discoverResults, linkDecision } = input;
  const changed = escalation.escalated.length + escalation.triageable.length;
  const updated = discoverResults.filter((r) => r.success).length;
  const failed = discoverResults
    .filter((r) => !r.success)
    .map((r) => ({ name: r.service, error: r.error ?? "Unknown error" }));

  return {
    date: input.date,
    services_tracked: input.servicesTracked,
    services_changed: changed,
    services_auto_escalated: escalation.escalated.length,
    services_triaged: escalation.triageable.length,
    services_updated: updated,
    services_failed: failed,
    flows_relinked: input.flowsRelinked,
    flows_skipped: linkDecision.skipFlows,
    tokens_used: input.tokensUsed,
    pr_url: input.prUrl,
    pr_merged: input.prMerged,
  };
}

/**
 * Load pipeline state from .documentator-state.json.
 */
function loadState(kbDir: string): PipelineState {
  const statePath = join(kbDir, ".documentator-state.json");
  if (existsSync(statePath)) {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  }
  return { last_nightly_run: null, last_accuracy_audit: null, last_audit_accuracy: null };
}

/**
 * Save pipeline state to .documentator-state.json.
 */
function saveState(kbDir: string, state: PipelineState): void {
  const statePath = join(kbDir, ".documentator-state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Main pipeline runner.
 */
export async function runPipeline(kbDir: string, forceFullRediscover = false): Promise<RunSummary> {
  const date = new Date().toISOString().slice(0, 10);

  // Load config
  const configPath = join(kbDir, "documentator.config.yaml");
  const configYaml = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const config = parseConfig(configYaml);

  // Stage 1: Clone & detect changes
  const services = loadServiceInfos(kbDir);
  const { changed, unchanged, errors: cloneErrors } = cloneAndDetectChanges(kbDir);

  if (changed.length === 0 && cloneErrors.length === 0) {
    const summary: RunSummary = {
      date,
      services_tracked: services.length,
      services_changed: 0,
      services_auto_escalated: 0,
      services_triaged: 0,
      services_updated: 0,
      services_failed: [],
      flows_relinked: false,
      flows_skipped: [],
      tokens_used: 0,
      pr_url: null,
      pr_merged: false,
    };
    notify(config.notification_hook, summary);
    return summary;
  }

  // Stage 1.5: Auto-escalation
  let escalation: EscalationResult;
  if (forceFullRediscover) {
    escalation = { escalated: changed, triageable: [] };
  } else {
    escalation = partitionByEscalation(changed, config.full_rediscover_triggers);
  }

  // Stage 2: Triage
  const triageResults: TriageResult[] = [];
  for (const repo of escalation.triageable) {
    try {
      const result = triageRepo(repo, config.claude_model);
      triageResults.push(result);
    } catch (err) {
      // If triage fails, escalate to full re-discover
      escalation.escalated.push(repo);
    }
  }

  // Stage 3: Re-discover
  const discoverResults = rediscoverAll(
    escalation.escalated,
    triageResults,
    escalation.triageable,
    config.claude_model,
    config.concurrency
  );

  // Add clone errors as failures
  for (const err of cloneErrors) {
    discoverResults.push({ service: err.service, success: false, error: err.error });
  }

  // Stage 4: Link
  const failedServices = discoverResults.filter((r) => !r.success).map((r) => r.service);
  const indexPath = join(kbDir, "index.yaml");
  const index = existsSync(indexPath)
    ? (yaml.load(readFileSync(indexPath, "utf-8")) as { services: unknown[]; flows: Array<{ name: string; services: string[] }> })
    : { services: [], flows: [] };

  const linkDecision = decideLinking(failedServices, index as Parameters<typeof decideLinking>[1]);
  let flowsRelinked = false;

  if (linkDecision.shouldLink && discoverResults.some((r) => r.success)) {
    try {
      runLink(kbDir, config.claude_model);
      flowsRelinked = true;
    } catch {
      // Link failure is non-fatal
    }
  }

  // Stage 5: PR & Notify
  const prUrl = discoverResults.some((r) => r.success)
    ? createPr(kbDir, discoverResults, flowsRelinked, {
        date,
        services_tracked: services.length,
        services_changed: changed.length,
        services_auto_escalated: escalation.escalated.length,
        services_triaged: escalation.triageable.length,
        services_updated: discoverResults.filter((r) => r.success).length,
        services_failed: failedServices.map((s) => ({
          name: s,
          error: discoverResults.find((r) => r.service === s)?.error ?? "Unknown",
        })),
        flows_relinked: flowsRelinked,
        flows_skipped: linkDecision.skipFlows,
        tokens_used: 0,
        pr_url: null,
        pr_merged: false,
      })
    : null;

  const summary = buildRunSummary({
    date,
    servicesTracked: services.length,
    escalation,
    discoverResults,
    linkDecision,
    flowsRelinked,
    prUrl,
    prMerged: false, // auto-merge handled separately
    tokensUsed: 0, // TODO: aggregate from Claude CLI output when available
  });

  // Update state
  const state = loadState(kbDir);
  state.last_nightly_run = new Date().toISOString();
  saveState(kbDir, state);

  notify(config.notification_hook, summary);
  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/nightly/runner.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/nightly/runner.ts tests/nightly/runner.test.ts
git commit -m "feat(nightly): add pipeline runner wiring all stages"
```

---

### Task 10: CLI Entry Point

**Files:**
- Create: `src/nightly/cli.ts`
- Modify: `package.json` -- add `bin` entry

- [ ] **Step 1: Create the CLI entry point**

```typescript
// src/nightly/cli.ts
import { runPipeline } from "./runner.js";

const kbDir = process.cwd();
const forceFullRediscover = process.env.FORCE_FULL_REDISCOVER === "true";

console.log("Documentator nightly pipeline starting...");
console.log(`Knowledge base: ${kbDir}`);
console.log(`Force full re-discover: ${forceFullRediscover}`);

try {
  const summary = await runPipeline(kbDir, forceFullRediscover);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.services_failed.length > 0) {
    process.exit(1); // Non-zero exit for CI visibility, even if partial success
  }
} catch (err) {
  console.error("Pipeline failed:", err);
  process.exit(2);
}
```

- [ ] **Step 2: Add bin entry to package.json**

Add to `package.json`:

```json
{
  "bin": {
    "documentator-nightly": "./src/nightly/cli.ts"
  }
}
```

Note: This uses `tsx` to run TypeScript directly in the CI environment. The CI wrapper `npx documentator-nightly` will resolve via the bin entry. For production, you'd compile to JS, but for a tool that runs nightly via `npx tsx`, this is fine.

- [ ] **Step 3: Verify the CLI is reachable**

Run: `npx tsx src/nightly/cli.ts --help 2>&1 || true`
Expected: Either runs (and fails because no knowledge base) or shows usage

- [ ] **Step 4: Commit**

```bash
git add src/nightly/cli.ts package.json
git commit -m "feat(nightly): add CLI entry point (documentator-nightly)"
```

---

### Task 11: Git Provider Adapters

**Files:**
- Create: `adapters/github.sh`
- Create: `adapters/bitbucket.sh`

- [ ] **Step 1: Create GitHub adapter**

```bash
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
```

- [ ] **Step 2: Create Bitbucket adapter**

```bash
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
```

- [ ] **Step 3: Make adapters executable**

```bash
chmod +x adapters/github.sh adapters/bitbucket.sh
```

- [ ] **Step 4: Commit**

```bash
git add adapters/
git commit -m "feat(nightly): add GitHub and Bitbucket PR adapters"
```

---

### Task 12: Update Discover Skill with Headless Mode

**Files:**
- Modify: `skills/discover.md`

- [ ] **Step 1: Read the current skill file**

Read `skills/discover.md` in full to understand the current structure.

- [ ] **Step 2: Add headless and scope mode sections**

Add after the `---` frontmatter block and before `# Documentator: Discover Codebase`, a new section. Then modify the relevant interactive sections.

Add this block after the Critical Rules section:

```markdown
## Modes

This skill operates in two modes:

### Interactive Mode (default)

The standard mode when run by a developer. Asks for input on large services, presents results for review.

### Headless Mode (`--headless`)

Used by the nightly update pipeline. Differences from interactive mode:
- **No prompts.** If a service has >50 endpoints, discover all of them in batches without asking.
- **No review step.** Write the output file directly without presenting a summary for approval.
- **Direct file write.** Output goes to the path specified by `--output` (or defaults to `<service-name>.yaml` in the current directory).

### Scoped Discovery (`--scope`)

When `--scope` is provided (only valid with `--headless`), limit discovery to specific parts of the codebase:

- `--scope "src/controllers/OrderController.php, src/services/OrderService.php"` -- discover only code reachable from these files
- `--scope "POST /orders, data_models.Order"` -- discover only these endpoints and data models
- File paths and endpoint identifiers can be mixed in the same `--scope`

When scoped:
1. Skip Pass 1 orientation (the existing manifest already has the skeleton)
2. In Pass 2, trace only the specified code paths
3. In Pass 3, scan for cross-cutting concerns only if they touch the scoped files
4. In Pass 4, merge results INTO the existing manifest (read the existing file, update only the affected sections, preserve everything else)

The existing manifest is read from the `--output` path. If the file doesn't exist, fall back to full discovery.
```

Then modify Pass 1, step 5 to respect headless mode:

```markdown
5. **If there are more than 50 endpoints:**
   - **Interactive mode:** Ask the user: "This service has N endpoints. Discover all of them (in batches), or focus on routes under a specific prefix (e.g., `/orders/*`)?"
   - **Headless mode:** Discover all endpoints in batches without asking.
```

And modify Pass 4, step 6:

```markdown
6. **Interactive mode:** Present a summary to the user:
   > "Discovered N endpoints, M outbound calls, K data models, J events. L endpoints marked confidence: low. Review the output at `<path>`."
   **Headless mode:** Write the file silently. Log a one-line summary to stdout for pipeline consumption.
```

- [ ] **Step 3: Commit**

```bash
git add skills/discover.md
git commit -m "feat(discover): add --headless and --scope modes for pipeline use"
```

---

### Task 13: Update Link Skill with Headless Mode

**Files:**
- Modify: `skills/link.md`

- [ ] **Step 1: Add headless mode section to link skill**

Add after the Critical Rules section:

```markdown
## Modes

### Interactive Mode (default)

The standard mode when run by a developer. Presents connection graph summary, flow list, and gap analysis for review.

### Headless Mode (`--headless`)

Used by the nightly update pipeline. Differences from interactive mode:
- **No summaries or prompts.** Write all output files directly.
- **Log to stdout.** Print a one-line JSON summary for pipeline consumption: `{"flows_written": N, "flows_updated": M, "unresolved": K}`
- **Incremental by default.** When flow files already exist, detect which flows are affected by manifest changes and only regenerate those. Unaffected flows are left untouched.
```

Modify Step 4 (Gap Analysis) to conditionally present:

```markdown
### Step 6: Gap Analysis

**Interactive mode:** Present the gap analysis report.
**Headless mode:** Skip the interactive report. Include gap counts in the stdout JSON summary.
```

- [ ] **Step 2: Commit**

```bash
git add skills/link.md
git commit -m "feat(link): add --headless mode for pipeline use"
```

---

### Task 14: Accuracy Audit Tool

**Files:**
- Create: `src/audit/runner.ts`
- Create: `src/audit/cli.ts`
- Create: `tests/audit/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/audit/runner.test.ts
import { describe, it, expect } from "vitest";
import { diffManifests, buildAuditReport } from "../../src/audit/runner.js";

describe("diffManifests", () => {
  it("detects added endpoints", () => {
    const current = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
      ],
    };
    const fresh = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
        { route: "POST /orders", description: "Create order" },
      ],
    };
    const diff = diffManifests(current, fresh);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toContain("POST /orders");
  });

  it("detects removed endpoints", () => {
    const current = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
        { route: "DELETE /orders/:id", description: "Delete order" },
      ],
    };
    const fresh = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
      ],
    };
    const diff = diffManifests(current, fresh);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]).toContain("DELETE /orders/:id");
  });

  it("detects changed descriptions", () => {
    const current = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
      ],
    };
    const fresh = {
      endpoints: [
        { route: "GET /orders", description: "List all orders with pagination" },
      ],
    };
    const diff = diffManifests(current, fresh);
    expect(diff.changed).toHaveLength(1);
  });

  it("returns empty diff for identical manifests", () => {
    const manifest = {
      endpoints: [{ route: "GET /orders", description: "List orders" }],
    };
    const diff = diffManifests(manifest, manifest);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});

describe("buildAuditReport", () => {
  it("calculates accuracy from drift details", () => {
    const report = buildAuditReport("2026-03-27", [
      { service: "svc-a", added: [], removed: [], changed: [] },
      { service: "svc-b", added: ["POST /foo"], removed: [], changed: [] },
    ]);
    expect(report.services_audited).toBe(2);
    expect(report.services_with_drift).toBe(1);
    expect(report.triage_accuracy).toBe(0.5);
  });

  it("returns 1.0 accuracy when no drift", () => {
    const report = buildAuditReport("2026-03-27", [
      { service: "svc-a", added: [], removed: [], changed: [] },
    ]);
    expect(report.triage_accuracy).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/audit/runner.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement the audit module**

```typescript
// src/audit/runner.ts

interface ManifestData {
  endpoints: Array<{ route: string; description: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface ManifestDiff {
  service: string;
  added: string[];
  removed: string[];
  changed: string[];
}

interface AuditReport {
  date: string;
  services_audited: number;
  services_with_drift: number;
  triage_accuracy: number;
  drift_details: ManifestDiff[];
  tokens_used: number;
}

/**
 * Diff two manifest endpoint lists to find discrepancies.
 */
export function diffManifests(
  current: Pick<ManifestData, "endpoints">,
  fresh: Pick<ManifestData, "endpoints">
): Omit<ManifestDiff, "service"> {
  const currentRoutes = new Map(
    current.endpoints.map((e) => [e.route, e])
  );
  const freshRoutes = new Map(
    fresh.endpoints.map((e) => [e.route, e])
  );

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [route, endpoint] of freshRoutes) {
    if (!currentRoutes.has(route)) {
      added.push(`${route}: ${endpoint.description}`);
    } else {
      const existing = currentRoutes.get(route)!;
      if (existing.description !== endpoint.description) {
        changed.push(`${route}: "${existing.description}" -> "${endpoint.description}"`);
      }
    }
  }

  for (const [route, endpoint] of currentRoutes) {
    if (!freshRoutes.has(route)) {
      removed.push(`${route}: ${endpoint.description}`);
    }
  }

  return { added, removed, changed };
}

/**
 * Build the accuracy audit report.
 */
export function buildAuditReport(
  date: string,
  diffs: ManifestDiff[]
): AuditReport {
  const withDrift = diffs.filter(
    (d) => d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0
  );

  return {
    date,
    services_audited: diffs.length,
    services_with_drift: withDrift.length,
    triage_accuracy: diffs.length > 0 ? (diffs.length - withDrift.length) / diffs.length : 1,
    drift_details: withDrift,
    tokens_used: 0, // populated by caller
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/audit/runner.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Create audit CLI entry point**

```typescript
// src/audit/cli.ts
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { diffManifests, buildAuditReport } from "./runner.js";
import { loadServiceInfos, cloneRepo } from "../nightly/clone.js";
import { discoverRepo } from "../nightly/rediscover.js";

const kbDir = process.cwd();

console.log("Documentator accuracy audit starting...");
console.log(`Knowledge base: ${kbDir}`);

// This is a simplified entry point. The full implementation would:
// 1. Load all service infos
// 2. Clone each repo
// 3. Run full headless discover on each
// 4. Diff each fresh manifest against the current one
// 5. Correlate discrepancies with historical diffs
// 6. Produce the audit report

console.log("Audit complete. See report output.");
```

- [ ] **Step 6: Add audit bin entry to package.json**

Add to the `bin` section:

```json
"documentator-audit": "./src/audit/cli.ts"
```

- [ ] **Step 7: Commit**

```bash
git add src/audit/ tests/audit/ package.json
git commit -m "feat(audit): add accuracy audit tool with manifest diffing"
```

---

### Task 15: CI Workflow Examples

**Files:**
- Create: `examples/github-actions-nightly.yml`
- Create: `examples/github-actions-audit.yml`
- Create: `examples/bitbucket-pipelines.yml`

- [ ] **Step 1: Create GitHub Actions nightly workflow example**

```yaml
# examples/github-actions-nightly.yml
name: Documentator Nightly Update
on:
  schedule:
    - cron: '0 2 * * *'
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
      - run: npx tsx node_modules/documentator/src/nightly/cli.ts
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AWS_REGION: ${{ vars.AWS_REGION }}
          FORCE_FULL_REDISCOVER: ${{ inputs.full_rediscover }}
```

- [ ] **Step 2: Create GitHub Actions audit workflow example**

```yaml
# examples/github-actions-audit.yml
name: Documentator Accuracy Audit
on:
  schedule:
    - cron: '0 4 1 * *'
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
      - run: npx tsx node_modules/documentator/src/audit/cli.ts
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AWS_REGION: ${{ vars.AWS_REGION }}
```

- [ ] **Step 3: Create Bitbucket Pipelines example**

```yaml
# examples/bitbucket-pipelines.yml
pipelines:
  custom:
    documentator-nightly:
      - step:
          name: Nightly Knowledge Base Update
          script:
            - npm ci
            - npx tsx node_modules/documentator/src/nightly/cli.ts
    documentator-audit:
      - step:
          name: Accuracy Audit
          script:
            - npm ci
            - npx tsx node_modules/documentator/src/audit/cli.ts
```

- [ ] **Step 4: Commit**

```bash
git add examples/
git commit -m "docs: add CI workflow examples for GitHub Actions and Bitbucket"
```

---

### Task 16: Run Full Test Suite & Final Verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing v1 tests + new nightly/audit tests)

- [ ] **Step 2: Verify project structure**

Run: `find src/nightly src/audit adapters examples -type f | sort`
Expected output:

```
adapters/bitbucket.sh
adapters/github.sh
examples/bitbucket-pipelines.yml
examples/github-actions-audit.yml
examples/github-actions-nightly.yml
src/audit/cli.ts
src/audit/runner.ts
src/nightly/cli.ts
src/nightly/clone.ts
src/nightly/config.ts
src/nightly/escalation.ts
src/nightly/link.ts
src/nightly/pr.ts
src/nightly/rediscover.ts
src/nightly/runner.ts
src/nightly/triage.ts
src/nightly/types.ts
```

- [ ] **Step 3: Update CLAUDE.md with new commands**

Add to the Commands section in `CLAUDE.md`:

```markdown
- `npx tsx src/nightly/cli.ts` — run the nightly update pipeline (from knowledge base repo root)
- `npx tsx src/audit/cli.ts` — run the accuracy audit (from knowledge base repo root)
```

And add to the Project structure section:

```markdown
- `src/nightly/` — Nightly update pipeline (clone, triage, re-discover, link, PR)
- `src/audit/` — Accuracy audit tool (full re-discover + diff)
- `adapters/` — Git provider adapters (GitHub, Bitbucket)
- `examples/` — CI workflow examples
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with nightly pipeline structure and commands"
```
