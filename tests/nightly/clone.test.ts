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
