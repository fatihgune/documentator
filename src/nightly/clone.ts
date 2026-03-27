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
