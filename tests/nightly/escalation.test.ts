import { describe, it, expect } from "vitest";
import { checkEscalation, getChangedFiles } from "../../src/nightly/escalation.js";

describe("getChangedFiles", () => {
  it("extracts file paths from a git diff", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
+import foo from 'bar';
diff --git a/package.json b/package.json
index 111..222 100644
--- a/package.json
+++ b/package.json
@@ -5,6 +5,7 @@
+  "minimatch": "^9.0.0"
`;
    const files = getChangedFiles(diff);
    expect(files).toEqual(["src/app.ts", "package.json"]);
  });

  it("returns empty array for empty diff", () => {
    expect(getChangedFiles("")).toEqual([]);
  });

  it("deduplicates file paths", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts`;
    const files = getChangedFiles(diff);
    expect(files).toEqual(["src/app.ts"]);
  });
});

describe("checkEscalation", () => {
  const triggers = [
    "package.json",
    "Dockerfile",
    "*.migration.*",
    "db/migrations/**",
  ];

  it("escalates when diff touches a trigger file", () => {
    const files = ["src/app.ts", "package.json"];
    expect(checkEscalation(files, triggers)).toBe(true);
  });

  it("does not escalate for non-trigger files", () => {
    const files = ["src/app.ts", "src/routes.ts"];
    expect(checkEscalation(files, triggers)).toBe(false);
  });

  it("matches glob patterns", () => {
    const files = ["src/20260327_add_users.migration.sql"];
    expect(checkEscalation(files, triggers)).toBe(true);
  });

  it("matches deep glob patterns", () => {
    const files = ["db/migrations/2026/03/create_orders.sql"];
    expect(checkEscalation(files, triggers)).toBe(true);
  });

  it("matches Dockerfile in subdirectory", () => {
    // "Dockerfile" pattern should match only top-level by default
    const files = ["docker/Dockerfile.dev"];
    expect(checkEscalation(files, triggers)).toBe(false);
  });

  it("returns false for empty file list", () => {
    expect(checkEscalation([], triggers)).toBe(false);
  });
});
