import { describe, it, expect } from "vitest";
import {
  buildPrBody,
  buildBranchName,
  detectGitProvider,
} from "../../src/nightly/pr.js";
import type { RunSummary } from "../../src/nightly/types.js";

describe("buildBranchName", () => {
  it("generates date-based branch name", () => {
    const name = buildBranchName("2026-03-27");
    expect(name).toBe("documentator/nightly-2026-03-27");
  });
});

describe("detectGitProvider", () => {
  it("detects github from remote URL", () => {
    expect(detectGitProvider("https://github.com/company/repo.git")).toBe("github");
    expect(detectGitProvider("git@github.com:company/repo.git")).toBe("github");
  });

  it("detects bitbucket from remote URL", () => {
    expect(detectGitProvider("https://bitbucket.org/company/repo.git")).toBe("bitbucket");
    expect(detectGitProvider("git@bitbucket.org:company/repo.git")).toBe("bitbucket");
  });

  it("returns unknown for unrecognized hosts", () => {
    expect(detectGitProvider("https://gitlab.com/company/repo.git")).toBe("unknown");
  });
});

describe("buildPrBody", () => {
  const summary: RunSummary = {
    date: "2026-03-27",
    services_tracked: 15,
    services_changed: 3,
    services_auto_escalated: 1,
    services_triaged: 2,
    services_updated: 2,
    services_failed: [{ name: "comms-service", error: "timeout" }],
    flows_relinked: false,
    flows_skipped: ["Send Notification"],
    tokens_used: 142300,
    pr_url: null,
    pr_merged: false,
  };

  it("includes service counts", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("15");
    expect(body).toContain("3");
    expect(body).toContain("2");
  });

  it("includes failure details", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("comms-service");
    expect(body).toContain("timeout");
  });

  it("includes skipped flows", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("Send Notification");
  });

  it("includes token usage", () => {
    const body = buildPrBody(summary);
    expect(body).toContain("142300");
  });
});
