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
