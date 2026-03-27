import { describe, it, expect } from "vitest";
import { parseTriageOutput, buildTriagePrompt } from "../../src/nightly/triage.js";

describe("buildTriagePrompt", () => {
  it("includes the manifest and diff in the prompt", () => {
    const prompt = buildTriagePrompt("order-service manifest yaml...", "diff content...");
    expect(prompt).toContain("order-service manifest yaml...");
    expect(prompt).toContain("diff content...");
    expect(prompt).toContain("JSON");
  });
});

describe("parseTriageOutput", () => {
  it("parses valid JSON triage output", () => {
    const output = `Some preamble text
\`\`\`json
{
  "affected_sections": [
    {"type": "endpoint", "identifier": "POST /orders", "files": ["src/controllers/OrderController.php"]},
    {"type": "data_model", "identifier": "Order", "files": ["src/models/Order.php"]}
  ]
}
\`\`\`
Some trailing text`;
    const result = parseTriageOutput("order-service", output);
    expect(result.service).toBe("order-service");
    expect(result.scope).toContain("src/controllers/OrderController.php");
    expect(result.scope).toContain("src/models/Order.php");
    expect(result.scope).toContain("POST /orders");
    expect(result.scope).toContain("data_models.Order");
  });

  it("deduplicates scope entries", () => {
    const output = `\`\`\`json
{
  "affected_sections": [
    {"type": "endpoint", "identifier": "POST /orders", "files": ["src/OrderController.php"]},
    {"type": "endpoint", "identifier": "GET /orders", "files": ["src/OrderController.php"]}
  ]
}
\`\`\``;
    const result = parseTriageOutput("svc", output);
    const fileOccurrences = result.scope.filter((s) => s === "src/OrderController.php");
    expect(fileOccurrences).toHaveLength(1);
  });

  it("throws on unparseable output", () => {
    expect(() => parseTriageOutput("svc", "no json here")).toThrow();
  });
});
