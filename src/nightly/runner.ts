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
    prMerged: false,
    tokensUsed: 0,
  });

  // Update state
  const state = loadState(kbDir);
  state.last_nightly_run = new Date().toISOString();
  saveState(kbDir, state);

  notify(config.notification_hook, summary);
  return summary;
}
