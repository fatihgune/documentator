import { describe, it, expect } from "vitest";
import { diffManifests, buildAuditReport } from "../../src/audit/runner.js";

describe("diffManifests", () => {
  it("detects added endpoints", () => {
    const current = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
      ],
    };
    const fresh = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
        { route: "POST /orders", description: "Create order" },
      ],
    };
    const diff = diffManifests(current, fresh);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toContain("POST /orders");
  });

  it("detects removed endpoints", () => {
    const current = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
        { route: "DELETE /orders/:id", description: "Delete order" },
      ],
    };
    const fresh = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
      ],
    };
    const diff = diffManifests(current, fresh);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]).toContain("DELETE /orders/:id");
  });

  it("detects changed descriptions", () => {
    const current = {
      endpoints: [
        { route: "GET /orders", description: "List orders" },
      ],
    };
    const fresh = {
      endpoints: [
        { route: "GET /orders", description: "List all orders with pagination" },
      ],
    };
    const diff = diffManifests(current, fresh);
    expect(diff.changed).toHaveLength(1);
  });

  it("returns empty diff for identical manifests", () => {
    const manifest = {
      endpoints: [{ route: "GET /orders", description: "List orders" }],
    };
    const diff = diffManifests(manifest, manifest);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});

describe("buildAuditReport", () => {
  it("calculates accuracy from drift details", () => {
    const report = buildAuditReport("2026-03-27", [
      { service: "svc-a", added: [], removed: [], changed: [] },
      { service: "svc-b", added: ["POST /foo"], removed: [], changed: [] },
    ]);
    expect(report.services_audited).toBe(2);
    expect(report.services_with_drift).toBe(1);
    expect(report.triage_accuracy).toBe(0.5);
  });

  it("returns 1.0 accuracy when no drift", () => {
    const report = buildAuditReport("2026-03-27", [
      { service: "svc-a", added: [], removed: [], changed: [] },
    ]);
    expect(report.triage_accuracy).toBe(1);
  });
});
