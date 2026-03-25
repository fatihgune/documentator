import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { validateServiceManifest } from "../src/validate.js";

const fixture = (path: string) =>
  yaml.load(readFileSync(join(__dirname, "fixtures", path), "utf-8"));

describe("validateServiceManifest", () => {
  it("accepts a valid service manifest", () => {
    const data = fixture("valid/order-service.yaml");
    const result = validateServiceManifest(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects manifest missing service.name", () => {
    const data = fixture("invalid/missing-service-name.yaml");
    const result = validateServiceManifest(data);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects manifest with invalid route format", () => {
    const data = fixture("invalid/bad-route-format.yaml");
    const result = validateServiceManifest(data);
    expect(result.valid).toBe(false);
  });
});
