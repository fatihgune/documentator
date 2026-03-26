import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { validateServiceManifest, validateFlow, validateIndex, detectFileType } from "../src/validate.js";

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

  it("accepts a minimal service manifest (thin service)", () => {
    const data = fixture("valid/communication-service.yaml");
    const result = validateServiceManifest(data);
    expect(result.valid).toBe(true);
  });
});

describe("validateFlow", () => {
  it("accepts a valid flow file", () => {
    const data = fixture("valid/place-order.flow.yaml");
    const result = validateFlow(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects flow missing trigger", () => {
    const data = {
      flow: {
        name: "Bad Flow",
        domain: "orders",
        services_involved: ["a", "b"],
      },
      steps: [
        { service: "a", action: "does something" },
        { service: "b", action: "does another thing" },
      ],
    };
    const result = validateFlow(data);
    expect(result.valid).toBe(false);
  });

  it("requires at least 2 steps", () => {
    const data = {
      flow: {
        name: "Too Short",
        domain: "orders",
        trigger: "Something happens",
        services_involved: ["a"],
      },
      steps: [{ service: "a", action: "only step" }],
    };
    const result = validateFlow(data);
    expect(result.valid).toBe(false);
  });
});

describe("validateIndex", () => {
  it("accepts a valid index file", () => {
    const data = fixture("valid/index.yaml");
    const result = validateIndex(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects index with missing service file path", () => {
    const data = {
      services: [
        { name: "order-service", summary: "Manages orders", endpoints_count: 5 },
      ],
      flows: [],
    };
    const result = validateIndex(data);
    expect(result.valid).toBe(false);
  });
});

describe("detectFileType", () => {
  it("detects service manifest by schema_version + service keys", () => {
    expect(detectFileType({ schema_version: 1, service: {}, endpoints: [] })).toBe(
      "service-manifest"
    );
  });

  it("detects flow by flow + steps keys", () => {
    expect(detectFileType({ flow: {}, steps: [] })).toBe("flow");
  });

  it("detects index by services + flows keys", () => {
    expect(detectFileType({ services: [], flows: [] })).toBe("index");
  });

  it("returns unknown for unrecognized structure", () => {
    expect(detectFileType({ foo: "bar" })).toBe("unknown");
  });
});
