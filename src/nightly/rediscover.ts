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
  return tasks.map((task) =>
    discoverRepo(task.clonePath, task.serviceName, task.manifestPath, model, task.scope)
  );
}
