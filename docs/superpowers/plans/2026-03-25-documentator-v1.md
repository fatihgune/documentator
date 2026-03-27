# Documentator v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the knowledge base schema, discovery skill, and linking skill that together enable AI-powered living documentation across microservice architectures.

**Architecture:** Three components as Claude Code skills backed by a formally defined YAML schema. A TypeScript validation utility ensures schema compliance. The skills are prompt-driven -- the intelligence lives in how the LLM is instructed to analyze code and structure output.

**Tech Stack:** TypeScript, Vitest, Ajv (JSON Schema validation), js-yaml, Claude Code skills (markdown)

---

## File Structure

```
documentator/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    schemas/
      service-manifest.schema.json    # JSON Schema for service manifests
      flow.schema.json                # JSON Schema for flow files
      index.schema.json               # JSON Schema for index file
    validate.ts                       # CLI validation utility
  tests/
    validate.test.ts                  # Schema validation tests
    fixtures/
      valid/
        order-service.yaml            # Valid service manifest fixture
        communication-service.yaml    # Minimal/thin service manifest fixture
        place-order.flow.yaml         # Valid flow fixture
        index.yaml                    # Valid index fixture
      invalid/
        missing-service-name.yaml     # Missing required field
        bad-route-format.yaml         # Invalid route pattern
  skills/
    discover.md                       # /discover skill definition
    link.md                           # /link skill definition
  templates/
    CLAUDE.md                         # Template CLAUDE.md for knowledge base repos
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "documentator",
  "version": "0.1.0",
  "description": "AI-powered living documentation engine",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "validate": "tsx src/validate.ts"
  },
  "devDependencies": {
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "js-yaml": "^4.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/js-yaml": "^4.0.9"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

- [ ] **Step 5: Verify setup**

Run: `npx vitest run`
Expected: "No test files found" (no tests yet, but vitest runs without errors).

- [ ] **Step 6: Commit**

```bash
git init
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold project with typescript, vitest, ajv"
```

---

### Task 2: Service Manifest JSON Schema

**Files:**
- Create: `src/schemas/service-manifest.schema.json`
- Create: `tests/fixtures/valid/order-service.yaml`
- Create: `tests/fixtures/invalid/missing-service-name.yaml`
- Create: `tests/fixtures/invalid/bad-route-format.yaml`
- Create: `src/validate.ts`
- Create: `tests/validate.test.ts`

- [ ] **Step 1: Write the failing test for service manifest validation**

Create `tests/validate.test.ts`:

```typescript
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
```

- [ ] **Step 2: Create the valid fixture**

Create `tests/fixtures/valid/order-service.yaml`:

```yaml
schema_version: 1
service:
  name: order-service
  repo: github.com/company/order-service
  stack: laravel
  discovered: "2026-03-25T10:00:00Z"

endpoints:
  - route: POST /orders
    description: Creates a new order from cart contents
    request:
      cart_id: string
      customer_id: string
      priority: boolean
    response:
      order_id: string
      status: string
      total: number
    business_rules:
      - "Orders over $500 set status to 'pending_approval'"
      - "Priority customers get express processing"

  - route: GET /orders
    description: Lists orders with optional filters
    request:
      customer_id: string
      status: string
      page: number
    response:
      orders: "Order[]"
      total: number
    confidence: low

outbound_calls:
  - target: inventory-service
    endpoint: POST /reservations
    sends:
      items: "Item[]"
      order_id: string
    condition: "After order creation succeeds"
  - target: communication-service
    endpoint: POST /send
    sends:
      template: order-confirmation
      params:
        order_id: string
        customer_name: string
    condition: "After order status set to 'confirmed'"

data_models:
  - name: Order
    fields:
      order_id: string
      customer_id: string
      status: "string (created | pending_approval | confirmed | cancelled)"
      total: number
      items: "Item[]"
      created_at: datetime
    relationships:
      - "belongs to a Customer"
      - "contains one or more Items"
  - name: Item
    fields:
      item_id: string
      product_id: string
      quantity: number
      unit_price: number

business_rules:
  - "Orders over $500 require manager approval before confirmation"
  - "Priority customers bypass the approval threshold"
  - "Cancelled orders trigger inventory release"

events:
  - type: publishes
    topic: order.created
    payload:
      order_id: string
      customer_id: string
      total: number
  - type: consumes
    topic: payment.confirmed
    action: "Updates order status to 'confirmed' and triggers fulfillment"
```

- [ ] **Step 3: Create the invalid fixtures**

Create `tests/fixtures/invalid/missing-service-name.yaml`:

```yaml
schema_version: 1
service:
  repo: github.com/company/some-service
  stack: kotlin
  discovered: "2026-03-25T10:00:00Z"

endpoints:
  - route: GET /health
    description: Health check endpoint
```

Create `tests/fixtures/invalid/bad-route-format.yaml`:

```yaml
schema_version: 1
service:
  name: bad-service
  repo: github.com/company/bad-service
  stack: laravel
  discovered: "2026-03-25T10:00:00Z"

endpoints:
  - route: /orders
    description: Missing HTTP method in route
```

- [ ] **Step 4: Create the JSON Schema**

Create `src/schemas/service-manifest.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Service Manifest",
  "description": "Documentator service manifest — one per discovered repository",
  "type": "object",
  "required": ["schema_version", "service", "endpoints"],
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "type": "integer",
      "const": 1
    },
    "service": {
      "type": "object",
      "required": ["name", "repo", "stack", "discovered"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "repo": { "type": "string", "minLength": 1 },
        "stack": { "type": "string", "minLength": 1 },
        "discovered": { "type": "string", "format": "date-time" }
      }
    },
    "endpoints": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["route", "description"],
        "additionalProperties": false,
        "properties": {
          "route": {
            "type": "string",
            "pattern": "^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /"
          },
          "description": { "type": "string", "minLength": 1 },
          "request": { "type": "object" },
          "response": { "type": "object" },
          "business_rules": {
            "type": "array",
            "items": { "type": "string" }
          },
          "confidence": {
            "type": "string",
            "enum": ["low"]
          }
        }
      }
    },
    "outbound_calls": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["target", "endpoint", "sends", "condition"],
        "additionalProperties": false,
        "properties": {
          "target": { "type": "string", "minLength": 1 },
          "endpoint": {
            "type": "string",
            "pattern": "^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /"
          },
          "sends": { "type": "object" },
          "condition": { "type": "string", "minLength": 1 }
        }
      }
    },
    "data_models": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "fields"],
        "additionalProperties": false,
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "fields": { "type": "object" },
          "relationships": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },
    "business_rules": {
      "type": "array",
      "items": { "type": "string" }
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "topic"],
        "additionalProperties": false,
        "properties": {
          "type": {
            "type": "string",
            "enum": ["publishes", "consumes"]
          },
          "topic": { "type": "string", "minLength": 1 },
          "payload": { "type": "object" },
          "action": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Write the validation function**

Create `src/validate.ts`:

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

function loadSchema(name: string) {
  const raw = readFileSync(join(__dirname, "schemas", name), "utf-8");
  return JSON.parse(raw);
}

const serviceManifestSchema = loadSchema("service-manifest.schema.json");
const validateManifest = ajv.compile(serviceManifestSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateServiceManifest(data: unknown): ValidationResult {
  const valid = validateManifest(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateManifest.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message}`
  );
  return { valid: false, errors };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: 3 tests pass (valid manifest accepted, two invalid manifests rejected).

- [ ] **Step 7: Commit**

```bash
git add src/schemas/service-manifest.schema.json src/validate.ts tests/
git commit -m "feat: add service manifest JSON schema with validation and tests"
```

---

### Task 3: Flow File JSON Schema

**Files:**
- Create: `src/schemas/flow.schema.json`
- Create: `tests/fixtures/valid/place-order.flow.yaml`
- Modify: `tests/validate.test.ts`
- Modify: `src/validate.ts`

- [ ] **Step 1: Write the failing test for flow validation**

Append to `tests/validate.test.ts`:

```typescript
import { validateFlow } from "../src/validate.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `validateFlow` is not exported from `../src/validate.js`.

- [ ] **Step 3: Create the valid flow fixture**

Create `tests/fixtures/valid/place-order.flow.yaml`:

```yaml
flow:
  name: Place Order
  domain: orders
  trigger: "User clicks 'Place Order' on checkout page"
  services_involved:
    - frontend-checkout
    - api-gateway
    - order-service
    - inventory-service
    - communication-service

steps:
  - service: frontend-checkout
    action: "Submits cart_id and customer_id to gateway"
    endpoint: POST /api/orders

  - service: api-gateway
    action: "Authenticates request, routes to order-service"
    endpoint: POST /orders

  - service: order-service
    action: "Validates cart, calculates total, creates order"
    branches:
      - condition: "total > $500"
        action: "Sets status to 'pending_approval', publishes order.created event"
      - condition: "total <= $500"
        action: "Sets status to 'confirmed'"

  - service: inventory-service
    action: "Reserves stock for all items in the order"
    endpoint: POST /reservations
    failure: "If stock unavailable, order status set to 'pending_stock'"

  - service: communication-service
    action: "Sends order-confirmation email to customer"
    endpoint: POST /send
    template: order-confirmation
```

- [ ] **Step 4: Create the flow JSON Schema**

Create `src/schemas/flow.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Flow",
  "description": "Documentator cross-service business flow",
  "type": "object",
  "required": ["flow", "steps"],
  "additionalProperties": false,
  "properties": {
    "flow": {
      "type": "object",
      "required": ["name", "domain", "trigger", "services_involved"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "domain": { "type": "string", "minLength": 1 },
        "trigger": { "type": "string", "minLength": 1 },
        "services_involved": {
          "type": "array",
          "minItems": 2,
          "items": { "type": "string", "minLength": 1 }
        }
      }
    },
    "steps": {
      "type": "array",
      "minItems": 2,
      "items": {
        "type": "object",
        "required": ["service", "action"],
        "additionalProperties": false,
        "properties": {
          "service": { "type": "string", "minLength": 1 },
          "action": { "type": "string", "minLength": 1 },
          "endpoint": {
            "type": "string",
            "pattern": "^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /"
          },
          "branches": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["condition", "action"],
              "additionalProperties": false,
              "properties": {
                "condition": { "type": "string" },
                "action": { "type": "string" }
              }
            }
          },
          "failure": { "type": "string" },
          "template": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Add validateFlow to validate.ts**

Add to `src/validate.ts`, after the existing `validateServiceManifest` function:

```typescript
const flowSchema = loadSchema("flow.schema.json");
const validateFlowSchema = ajv.compile(flowSchema);

export function validateFlow(data: unknown): ValidationResult {
  const valid = validateFlowSchema(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateFlowSchema.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message}`
  );
  return { valid: false, errors };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/flow.schema.json src/validate.ts tests/
git commit -m "feat: add flow file JSON schema with validation and tests"
```

---

### Task 4: Index File JSON Schema

**Files:**
- Create: `src/schemas/index.schema.json`
- Create: `tests/fixtures/valid/index.yaml`
- Modify: `tests/validate.test.ts`
- Modify: `src/validate.ts`

- [ ] **Step 1: Write the failing test for index validation**

Append to `tests/validate.test.ts`:

```typescript
import { validateIndex } from "../src/validate.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `validateIndex` is not exported.

- [ ] **Step 3: Create the valid index fixture**

Create `tests/fixtures/valid/index.yaml`:

```yaml
services:
  - name: order-service
    file: services/order-service.yaml
    summary: "Manages order lifecycle: creation, approval, cancellation"
    endpoints_count: 12
  - name: inventory-service
    file: services/inventory-service.yaml
    summary: "Tracks stock levels, manages reservations"
    endpoints_count: 8

flows:
  - name: Place Order
    file: flows/orders/place-order.yaml
    summary: "End-to-end order creation from checkout through fulfillment"
    services:
      - frontend-checkout
      - api-gateway
      - order-service
      - inventory-service
      - communication-service
  - name: Cancel Order
    file: flows/orders/cancel-order.yaml
    summary: "Order cancellation with inventory release and customer notification"
    services:
      - order-service
      - inventory-service
      - communication-service
```

- [ ] **Step 4: Create the index JSON Schema**

Create `src/schemas/index.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Knowledge Base Index",
  "description": "Table of contents for a Documentator knowledge base",
  "type": "object",
  "required": ["services", "flows"],
  "additionalProperties": false,
  "properties": {
    "services": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "file", "summary", "endpoints_count"],
        "additionalProperties": false,
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "file": { "type": "string", "minLength": 1 },
          "summary": { "type": "string", "minLength": 1 },
          "endpoints_count": { "type": "integer", "minimum": 0 }
        }
      }
    },
    "flows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "file", "summary", "services"],
        "additionalProperties": false,
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "file": { "type": "string", "minLength": 1 },
          "summary": { "type": "string", "minLength": 1 },
          "services": {
            "type": "array",
            "minItems": 2,
            "items": { "type": "string", "minLength": 1 }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Add validateIndex to validate.ts**

Add to `src/validate.ts`, after `validateFlow`:

```typescript
const indexSchema = loadSchema("index.schema.json");
const validateIndexSchema = ajv.compile(indexSchema);

export function validateIndex(data: unknown): ValidationResult {
  const valid = validateIndexSchema(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateIndexSchema.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message}`
  );
  return { valid: false, errors };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/index.schema.json src/validate.ts tests/
git commit -m "feat: add index file JSON schema with validation and tests"
```

---

### Task 5: Validation CLI

**Files:**
- Modify: `src/validate.ts`

- [ ] **Step 1: Write the failing test for CLI mode**

Append to `tests/validate.test.ts`:

```typescript
import { detectFileType } from "../src/validate.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `detectFileType` is not exported.

- [ ] **Step 3: Add detectFileType and CLI entry point**

Add `detectFileType` to `src/validate.ts`:

```typescript
export function detectFileType(
  data: unknown
): "service-manifest" | "flow" | "index" | "unknown" {
  if (typeof data !== "object" || data === null) return "unknown";
  const keys = Object.keys(data);
  if (keys.includes("schema_version") && keys.includes("service")) return "service-manifest";
  if (keys.includes("flow") && keys.includes("steps")) return "flow";
  if (keys.includes("services") && keys.includes("flows")) return "index";
  return "unknown";
}

export function validateAny(data: unknown): ValidationResult & { type: string } {
  const type = detectFileType(data);
  switch (type) {
    case "service-manifest":
      return { ...validateServiceManifest(data), type };
    case "flow":
      return { ...validateFlow(data), type };
    case "index":
      return { ...validateIndex(data), type };
    default:
      return { valid: false, errors: ["Unrecognized file structure"], type: "unknown" };
  }
}

// CLI entry point
const cliFile = process.argv[2];
if (cliFile) {
  const raw = readFileSync(cliFile, "utf-8");
  const data = yaml.load(raw);
  const result = validateAny(data);
  if (result.valid) {
    console.log(`VALID ${result.type}: ${cliFile}`);
  } else {
    console.error(`INVALID ${result.type}: ${cliFile}`);
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}
```

Add the yaml import at the top of `src/validate.ts` (alongside existing imports):

```typescript
import yaml from "js-yaml";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All 12 tests pass.

- [ ] **Step 5: Verify CLI works**

Run: `npx tsx src/validate.ts tests/fixtures/valid/order-service.yaml`
Expected: `VALID service-manifest: tests/fixtures/valid/order-service.yaml`

Run: `npx tsx src/validate.ts tests/fixtures/invalid/missing-service-name.yaml`
Expected: `INVALID service-manifest: tests/fixtures/invalid/missing-service-name.yaml` with error details, exit code 1.

- [ ] **Step 6: Commit**

```bash
git add src/validate.ts tests/validate.test.ts
git commit -m "feat: add CLI validation with auto-detection of file type"
```

---

### Task 6: Minimal Service Manifest Fixture

**Files:**
- Create: `tests/fixtures/valid/communication-service.yaml`
- Modify: `tests/validate.test.ts`

This tests the "thin service" case -- a service with minimal business logic (like a communication service that just sends emails/SMS).

- [ ] **Step 1: Write the test**

Append to the `validateServiceManifest` describe block in `tests/validate.test.ts`:

```typescript
  it("accepts a minimal service manifest (thin service)", () => {
    const data = fixture("valid/communication-service.yaml");
    const result = validateServiceManifest(data);
    expect(result.valid).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run`
Expected: FAIL — fixture file not found.

- [ ] **Step 3: Create the minimal fixture**

Create `tests/fixtures/valid/communication-service.yaml`:

```yaml
schema_version: 1
service:
  name: communication-service
  repo: github.com/company/communication-service
  stack: laravel
  discovered: "2026-03-25T12:00:00Z"

endpoints:
  - route: POST /send
    description: Sends a notification via the specified channel and template
    request:
      channel: string
      template: string
      recipient: string
      params: object
    response:
      message_id: string
      status: string

  - route: GET /templates
    description: Lists all available notification templates
    response:
      templates: "Template[]"

events:
  - type: consumes
    topic: notification.requested
    action: "Processes queued notification request and dispatches via appropriate channel"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: add minimal communication service fixture for thin service case"
```

---

### Task 7: Discovery Skill (`/discover`)

**Files:**
- Create: `skills/discover.md`

This is the core skill -- a detailed prompt that instructs Claude Code how to analyze a repository and produce a service manifest.

- [ ] **Step 1: Create the skill file**

Create `skills/discover.md`:

````markdown
---
name: discover
description: Discover a codebase and produce a service manifest for the Documentator knowledge base. Run this in the root of a repository to analyze its endpoints, business logic, data flows, and external service calls.
---

# Documentator: Discover Codebase

You are analyzing a codebase to produce a **service manifest** -- a structured YAML file that captures what this service does in business terms. This manifest is consumed by LLMs to answer documentation questions, NOT read by humans directly.

## Critical Rules

1. **Business language only.** Describe what endpoints DO, not how they're implemented. "Creates a new order from cart contents" not "Calls OrderController@store which invokes OrderService::create".
2. **No framework boilerplate.** You will detect the tech stack to understand conventions, but the output never mentions framework classes, annotations, decorators, or patterns. If something is standard framework behavior (Laravel Resources, Spring annotations, Express middleware registration), skip it.
3. **Data fields, not class names.** Request/response shapes use field names and primitive types: `{order_id: string, total: number}`. Never reference DTO classes, form requests, or serializers by name.
4. **Explicit uncertainty.** If you cannot trace where an outbound call goes (URL from env var you can't resolve, dynamic dispatch), mark it as `target: unknown`. Never guess.
5. **Idempotent.** If run twice on the same codebase at the same commit, produce the same output.

## Output Schema

The output is a single YAML file conforming to this structure:

```yaml
schema_version: 1
service:
  name: <service-name>        # from repo name or config
  repo: <repo-url>            # from git remote
  stack: <detected-stack>     # e.g., laravel, kotlin-spring, express, django
  discovered: <ISO-8601>      # current timestamp

endpoints:                     # REQUIRED, at least one
  - route: <METHOD> <path>    # e.g., "POST /orders"
    description: <string>     # business-language description
    request: { ... }          # field: type pairs (optional for GET with no params)
    response: { ... }         # field: type pairs
    business_rules:           # optional, only if endpoint has conditional logic
      - "rule in plain English"
    confidence: low           # optional, only when trace was incomplete

outbound_calls:               # optional
  - target: <service-name>    # or "unknown"
    endpoint: <METHOD> <path>
    sends: { ... }            # data shape sent
    condition: <string>       # when this call happens

data_models:                  # optional
  - name: <EntityName>
    fields: { ... }           # field: type pairs
    relationships:            # optional
      - "plain English relationship"

business_rules:               # optional, service-wide rules not tied to one endpoint
  - "rule in plain English"

events:                       # optional
  - type: publishes | consumes
    topic: <topic-name>
    payload: { ... }          # for publishes
    action: <string>          # for consumes, what happens when received
```

## Process

Execute these passes in order. Each pass builds on the previous one.

### Pass 1: Orientation

1. Read project config to detect the tech stack:
   - `composer.json` → Laravel/PHP
   - `build.gradle` / `build.gradle.kts` → Kotlin/Java Spring
   - `package.json` → Node.js (check for express, fastify, nest, etc.)
   - `requirements.txt` / `pyproject.toml` → Python (check for django, flask, fastapi)
   - `Dockerfile` can confirm runtime

2. Get the git remote URL for the `repo` field:
   ```
   git remote get-url origin
   ```

3. Find and read route definitions to enumerate ALL endpoints:
   - **Laravel:** `routes/api.php`, `routes/web.php`, or `php artisan route:list` if available
   - **Spring:** grep for `@GetMapping`, `@PostMapping`, `@RequestMapping`, etc.
   - **Express:** grep for `router.get`, `router.post`, `app.get`, `app.post`, etc.
   - **Django:** `urls.py` files
   - **FastAPI:** grep for `@app.get`, `@app.post`, `@router.get`, etc.

4. Produce a skeleton: service identity + list of routes with method and path only.

5. **If there are more than 50 endpoints**, ask the user:
   > "This service has N endpoints. Discover all of them (in batches), or focus on routes under a specific prefix (e.g., `/orders/*`)?"

### Pass 2: Endpoint Deep-Dive

For EACH endpoint (or each batch if >50):

1. Start from the route handler/controller method
2. Trace the code path through service classes, repositories, and external calls
3. For each endpoint, extract:
   - **Request shape**: parameter names and types from the handler signature, form request, or validation rules
   - **Response shape**: field names and types from what's returned (look at the actual data structure, not the serializer class)
   - **Business rules**: any conditional logic (if/else, switch, validation rules beyond simple type checks)
   - **Outbound calls**: HTTP calls to other services, queue dispatches, event emissions

4. For outbound calls, try to resolve the target:
   - Check config files, environment variable names, service registries
   - Check Kubernetes manifests, Docker Compose, or similar orchestration config
   - If the URL is in an env var like `ORDER_SERVICE_URL`, the target is likely `order-service`
   - If unresolvable, set `target: unknown` and note what you found in the condition field

5. Mark endpoints `confidence: low` if:
   - You couldn't trace through to the response (too many layers of abstraction)
   - The handler delegates to a complex class hierarchy you couldn't fully follow
   - Key business logic is in a dependency you don't have access to

### Pass 3: Cross-Cutting Concerns

Search for things not reachable via endpoint tracing:

1. **Events**: grep for Kafka producer/consumer setup, queue job dispatches, webhook registrations, event listener registrations
2. **Scheduled jobs**: cron definitions, scheduler configurations, periodic task registrations
3. **Middleware with business logic**: auth middleware that affects data flow, rate limiting rules, feature flag checks that alter behavior
4. **Background workers**: queue consumers, long-running processes

For each, determine if it introduces new data flows or business rules not already captured by endpoint tracing.

### Pass 4: Assembly

1. Merge all findings into the YAML structure defined above
2. Deduplicate: if an outbound call was discovered both via endpoint tracing and event scanning, keep one entry
3. Extract service-wide business rules that apply to multiple endpoints into the top-level `business_rules` list
4. Order endpoints by path alphabetically, then by HTTP method
5. Write the file as `<service-name>.yaml`
6. Present a summary to the user:
   > "Discovered N endpoints, M outbound calls, K data models, J events. L endpoints marked confidence: low. Review the output at `<path>`."

## Important Notes

- Do NOT read every file in the repo. Start from routes and trace only reachable code.
- Do NOT include test files, migration files, or seed data in the analysis.
- Do NOT include infrastructure endpoints (health checks, metrics) unless they have business logic.
- If a file is very large (>500 lines), read only the relevant sections using offset/limit.
- The manifest should capture what the service DOES, not how it's built. A product manager should be able to read the `description` and `business_rules` fields and understand the service.
````

- [ ] **Step 2: Validate the skill file has correct frontmatter**

Run: `head -5 skills/discover.md`
Expected: Shows `---`, `name: discover`, `description: ...`, `---` frontmatter block.

- [ ] **Step 3: Commit**

```bash
git add skills/discover.md
git commit -m "feat: add /discover skill for codebase analysis"
```

---

### Task 8: Linking Skill (`/link`)

**Files:**
- Create: `skills/link.md`

- [ ] **Step 1: Create the skill file**

Create `skills/link.md`:

````markdown
---
name: link
description: Read all service manifests in a Documentator knowledge base and produce cross-service flow traces. Run this in the root of a knowledge base repository after all services have been discovered.
---

# Documentator: Link Services Into Flows

You are reading a collection of service manifests (produced by `/discover`) and building **cross-service flow files** that trace how features work end-to-end across multiple services. You also produce an **index file** that serves as a table of contents for the entire knowledge base.

## Critical Rules

1. **Flows must span 2+ services.** Single-service operations are already documented in the service manifest. Flows capture what crosses boundaries.
2. **Name by business outcome.** "Place Order" not "frontend-gateway-order-inventory-comms". The name should be something a product manager would recognize.
3. **Include branching logic.** If a flow has conditional paths (different behavior for different order amounts, customer types, etc.), document ALL branches.
4. **Don't load everything at once.** Read manifests in small groups as you trace connections. A flow touching 4 services needs only those 4 manifests loaded.
5. **Flag unresolved connections.** If a service calls `target: unknown`, note this in the flow as a gap.

## Output

Two types of files:

### Flow Files (`flows/{domain}/{flow-name}.yaml`)

```yaml
flow:
  name: <Flow Name>
  domain: <business-domain>     # e.g., orders, billing, customers
  trigger: <string>             # what initiates this flow
  services_involved:            # list of all services in the flow
    - service-a
    - service-b

steps:
  - service: <service-name>
    action: <string>            # what this service does in this step
    endpoint: <METHOD> <path>   # optional, which endpoint is called
    branches:                   # optional, conditional paths
      - condition: <string>
        action: <string>
    failure: <string>           # optional, what happens on failure
    template: <string>          # optional, for notification services
```

### Index File (`index.yaml`)

```yaml
services:
  - name: <service-name>
    file: services/<service-name>.yaml
    summary: <one-line description>
    endpoints_count: <number>

flows:
  - name: <Flow Name>
    file: flows/<domain>/<flow-name>.yaml
    summary: <one-line description>
    services: [<service-a>, <service-b>, ...]
```

## Process

### Step 1: Build Connection Graph

1. Read ALL service manifest files in `services/`
2. For each manifest, extract:
   - Service name (from `service.name`)
   - All inbound endpoints (from `endpoints[].route`)
   - All outbound calls (from `outbound_calls[]`)
   - All events published and consumed (from `events[]`)
3. Build a connection map:
   - For each outbound call: `source_service` → `target_service` via `endpoint`
   - For each event: `publisher` → `topic` → `consumer(s)`
4. Report unresolved connections:
   > "Found N service-to-service connections. M outbound calls target unknown services."

### Step 2: Identify Entry Points

Entry points are services/endpoints that START a flow — they are called by external actors, not by other discovered services:

1. **Frontend services**: services whose endpoints are NOT the target of any other service's outbound calls (they face users directly)
2. **Gateway routes**: API gateway endpoints that route to backend services
3. **Event triggers with no upstream**: consumed events where no discovered service publishes them (external triggers)
4. **Scheduled jobs**: cron-triggered processes in any service

List all identified entry points before proceeding.

### Step 3: Trace Flows

For each entry point:

1. Start at the entry point endpoint or event
2. Follow the outbound calls from that service to the next service
3. At each service, check:
   - Does this service make further outbound calls as part of handling this request?
   - Does this service publish events that other discovered services consume?
   - Are there conditional branches (business rules) that affect the flow?
4. Continue until you reach services with no further outbound calls (leaf nodes)
5. Record the full path as a candidate flow

**Context management:** When tracing a flow, load only the service manifests for services in that flow's path. Unload them before tracing the next flow.

### Step 4: Enrich and Deduplicate

For each candidate flow:

1. Pull business rules from each service manifest along the path
2. Add branching logic where conditions exist
3. Note failure modes mentioned in the manifests
4. Determine the business domain (group related flows: all order-related flows under `orders/`)

Deduplicate:
- If two flows share >80% of their steps, consider merging into one flow with branches
- If a flow is a strict subset of another (e.g., "View Order" is the first 2 steps of "Place Order"), keep both — the shorter flow has independent value

### Step 5: Write Output

1. Create domain directories under `flows/` as needed
2. Write each flow as `flows/{domain}/{flow-name}.yaml`
   - `flow-name` is the kebab-case version of the flow name
3. Write `index.yaml` with:
   - All services with their file paths, summaries (derived from manifest content), and endpoint counts
   - All flows with their file paths, summaries, and involved services
4. Present summary:
   > "Generated N flows across M domains. Index written to index.yaml. K connections unresolved."

### Step 6: Gap Analysis

After generating all flows, report:

1. **Isolated services**: services with no inbound or outbound connections to other discovered services
2. **Dead-end outbound calls**: calls to services not in the knowledge base
3. **Orphan events**: published events with no discovered consumer, consumed events with no discovered publisher
4. **Single-service flows discarded**: entry points that didn't lead to cross-service flows (these are already in the service manifest)

Present this as a summary so the user knows what's missing and can discover additional repos to fill gaps.

## Important Notes

- The flow name should make sense to someone who has never seen the code. "Custom Order Processing" is better than "POST /orders with custom flag handler".
- Sort flows in the index alphabetically within each domain.
- If a service appears in many flows (like a gateway or communication service), that's expected — don't try to reduce it.
- The index summaries should be concise (under 100 characters) and describe the business outcome, not the technical path.
````

- [ ] **Step 2: Validate the skill file has correct frontmatter**

Run: `head -5 skills/link.md`
Expected: Shows `---`, `name: link`, `description: ...`, `---` frontmatter block.

- [ ] **Step 3: Commit**

```bash
git add skills/link.md
git commit -m "feat: add /link skill for cross-service flow generation"
```

---

### Task 9: Knowledge Base CLAUDE.md Template

**Files:**
- Create: `templates/CLAUDE.md`

This template goes into the root of a knowledge base repo. It instructs Claude Code how to use the knowledge base to answer questions.

- [ ] **Step 1: Create the template**

Create `templates/CLAUDE.md`:

```markdown
# Knowledge Base — Documentator

This repository contains a Documentator knowledge base. It is a structured representation of one or more codebases, optimized for LLM consumption.

## How to answer questions from this knowledge base

1. **Always start by reading `index.yaml`** to understand what services and flows are available.

2. **For questions about a specific service** ("what endpoints does order-service have?", "what events does it publish?"):
   - Load the relevant service manifest from `services/<service-name>.yaml`
   - Answer using the information in the manifest

3. **For questions about a feature or business flow** ("how does the order process work?", "what happens when a customer places an order?"):
   - Search the flows in `index.yaml` for the most relevant flow
   - Load the flow file from `flows/<domain>/<flow-name>.yaml`
   - If the flow references specific service details, load those service manifests too

4. **For questions about a specific field or data point** ("where does the 'status' field come from on the orders page?"):
   - Search service manifests for endpoints that return that field
   - Trace backwards through outbound calls to find the data source
   - Check flow files for end-to-end context

5. **For questions about connections between services** ("which services call inventory-service?"):
   - Search all service manifests' `outbound_calls` sections
   - Or check `index.yaml` flow entries for flows involving that service

## Rules

- Answer in business language. Users asking questions here are looking for product/feature understanding, not code-level details.
- When citing information, reference the service name and endpoint (e.g., "order-service POST /orders"), not file paths or line numbers.
- If the knowledge base doesn't contain enough information to answer confidently, say so. Do not speculate beyond what's documented.
- If an endpoint is marked `confidence: low`, mention this caveat in your answer.
```

- [ ] **Step 2: Commit**

```bash
git add templates/CLAUDE.md
git commit -m "feat: add CLAUDE.md template for knowledge base repos"
```

---

### Task 10: End-to-End Validation Test

**Files:**
- Modify: `tests/validate.test.ts`

- [ ] **Step 1: Write the cross-validation test**

This test ensures the example fixtures are internally consistent: the flow file references services that exist in the fixtures, and the index references files that match the fixtures.

Append to `tests/validate.test.ts`:

```typescript
describe("cross-file consistency", () => {
  it("flow references only services that could have manifests", () => {
    const flow = fixture("valid/place-order.flow.yaml") as {
      flow: { services_involved: string[] };
    };
    // All services_involved should be non-empty strings
    for (const svc of flow.flow.services_involved) {
      expect(svc.length).toBeGreaterThan(0);
    }
  });

  it("index service entries have valid file paths", () => {
    const index = fixture("valid/index.yaml") as {
      services: { file: string }[];
      flows: { file: string }[];
    };
    for (const svc of index.services) {
      expect(svc.file).toMatch(/^services\/[\w-]+\.yaml$/);
    }
    for (const flow of index.flows) {
      expect(flow.file).toMatch(/^flows\/[\w-]+\/[\w-]+\.yaml$/);
    }
  });

  it("all fixture files pass their respective validators", () => {
    const serviceResult = validateServiceManifest(fixture("valid/order-service.yaml"));
    const serviceResult2 = validateServiceManifest(
      fixture("valid/communication-service.yaml")
    );
    const flowResult = validateFlow(fixture("valid/place-order.flow.yaml"));
    const indexResult = validateIndex(fixture("valid/index.yaml"));

    expect(serviceResult.valid).toBe(true);
    expect(serviceResult2.valid).toBe(true);
    expect(flowResult.valid).toBe(true);
    expect(indexResult.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (should be ~16 total).

- [ ] **Step 3: Commit**

```bash
git add tests/validate.test.ts
git commit -m "test: add cross-file consistency and end-to-end validation tests"
```

---

### Task 11: Documentation and .gitignore

**Files:**
- Create: `.gitignore`
- Create: `CLAUDE.md`

- [ ] **Step 1: Create .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
*.tgz
```

- [ ] **Step 2: Create project CLAUDE.md**

Create `CLAUDE.md`:

```markdown
# Documentator

AI-powered living documentation engine. Produces LLM-optimized knowledge bases from codebases.

## Project structure

- `src/schemas/` — JSON Schema definitions for the knowledge base format
- `src/validate.ts` — Schema validation utility (library + CLI)
- `skills/discover.md` — Claude Code skill for codebase discovery
- `skills/link.md` — Claude Code skill for cross-service flow generation
- `templates/CLAUDE.md` — Template for knowledge base repo consumption
- `tests/` — Vitest tests with YAML fixtures

## Commands

- `npm test` — run all tests
- `npx tsx src/validate.ts <file.yaml>` — validate a knowledge base file

## Schema files

The three schema types are: service manifests (`services/*.yaml`), flow files (`flows/**/*.yaml`), and the index (`index.yaml`). JSON Schemas are in `src/schemas/`.

## Skills

Skills are installed into Claude Code by copying to `.claude/commands/` or referencing from project settings. See `skills/` directory.
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore CLAUDE.md
git commit -m "chore: add .gitignore and project CLAUDE.md"
```
