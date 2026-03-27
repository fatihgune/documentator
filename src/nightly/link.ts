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

  if (skipFlows.length === index.flows.length && index.flows.length > 0) {
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
