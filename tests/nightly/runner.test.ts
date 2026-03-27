import { describe, it, expect } from "vitest";
import { buildRunSummary } from "../../src/nightly/runner.js";
import type { DiscoverResult, LinkDecision, EscalationResult } from "../../src/nightly/types.js";

describe("buildRunSummary", () => {
  it("produces correct summary from pipeline results", () => {
    const escalation: EscalationResult = {
      escalated: [{ service: { name: "svc-a", repo: "", discovered: "", manifestPath: "" }, clonePath: "", diff: "" }],
      triageable: [
        { service: { name: "svc-b", repo: "", discovered: "", manifestPath: "" }, clonePath: "", diff: "" },
        { service: { name: "svc-c", repo: "", discovered: "", manifestPath: "" }, clonePath: "", diff: "" },
      ],
    };

    const discoverResults: DiscoverResult[] = [
      { service: "svc-a", success: true },
      { service: "svc-b", success: true },
      { service: "svc-c", success: false, error: "timeout" },
    ];

    const linkDecision: LinkDecision = {
      shouldLink: true,
      skipFlows: ["Flow X"],
      reason: "svc-c participates in Flow X",
    };

    const summary = buildRunSummary({
      date: "2026-03-27",
      servicesTracked: 10,
      escalation,
      discoverResults,
      linkDecision,
      flowsRelinked: true,
      prUrl: "https://github.com/co/kb/pull/1",
      prMerged: false,
      tokensUsed: 50000,
    });

    expect(summary.services_tracked).toBe(10);
    expect(summary.services_changed).toBe(3);
    expect(summary.services_auto_escalated).toBe(1);
    expect(summary.services_triaged).toBe(2);
    expect(summary.services_updated).toBe(2);
    expect(summary.services_failed).toHaveLength(1);
    expect(summary.services_failed[0].name).toBe("svc-c");
    expect(summary.flows_relinked).toBe(true);
    expect(summary.flows_skipped).toEqual(["Flow X"]);
    expect(summary.tokens_used).toBe(50000);
    expect(summary.pr_url).toBe("https://github.com/co/kb/pull/1");
  });
});
