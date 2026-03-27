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
    triggers.some((pattern) => minimatch(file, pattern, { matchBase: true }))
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
