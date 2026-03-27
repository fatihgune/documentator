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
