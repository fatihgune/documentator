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
