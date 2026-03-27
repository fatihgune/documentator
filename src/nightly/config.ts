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
