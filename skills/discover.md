---
name: documentator:discover
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

## Modes

This skill operates in two modes:

### Interactive Mode (default)

The standard mode when run by a developer. Asks for input on large services, presents results for review.

### Headless Mode (`--headless`)

Used by the nightly update pipeline. Differences from interactive mode:
- **No prompts.** If a service has >50 endpoints, discover all of them in batches without asking.
- **No review step.** Write the output file directly without presenting a summary for approval.
- **Direct file write.** Output goes to the path specified by `--output` (or defaults to `<service-name>.yaml` in the current directory).

### Scoped Discovery (`--scope`)

When `--scope` is provided (only valid with `--headless`), limit discovery to specific parts of the codebase:

- `--scope "src/controllers/OrderController.php, src/services/OrderService.php"` -- discover only code reachable from these files
- `--scope "POST /orders, data_models.Order"` -- discover only these endpoints and data models
- File paths and endpoint identifiers can be mixed in the same `--scope`

When scoped:
1. Skip Pass 1 orientation (the existing manifest already has the skeleton)
2. In Pass 2, trace only the specified code paths
3. In Pass 3, scan for cross-cutting concerns only if they touch the scoped files
4. In Pass 4, merge results INTO the existing manifest (read the existing file, update only the affected sections, preserve everything else)

The existing manifest is read from the `--output` path. If the file doesn't exist, fall back to full discovery.

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

5. **If there are more than 50 endpoints:**
   - **Interactive mode:** Ask the user: "This service has N endpoints. Discover all of them (in batches), or focus on routes under a specific prefix (e.g., `/orders/*`)?"
   - **Headless mode:** Discover all endpoints in batches without asking.

### Pass 2: Endpoint Deep-Dive

For EACH endpoint (or each batch if >50):

1. Start from the route handler/controller method
2. **Follow the full call chain.** Do not stop at the controller. Read into service classes, domain objects, repositories, and helper methods. If the handler calls `OrderService::create()`, read that method. If that method calls `DiscountCalculator::apply()`, read that too. Follow until you reach data access or external calls -- typically 2-4 levels deep.
3. For each endpoint, extract:
   - **Request shape**: parameter names and types from the handler signature, form request, or validation rules
   - **Response shape**: field names and types from what's returned (look at the actual data structure, not the serializer class)
   - **Business rules**: every conditional branch that affects behavior. This includes:
     - Obvious top-level conditions (`if total > 500, require approval`)
     - Nested conditions in service classes (`if customer.tier == 'gold', bypass verification`)
     - Guard clauses and early returns that change the flow
     - Switch/match statements that route to different behaviors
     - Validation rules beyond simple type checks (business constraints like "quantity must be > 0 and <= stock")
     - Feature flags or config-driven behavior (`if feature('new_checkout') enabled, use v2 flow`)
   - **Outbound calls**: HTTP calls to other services, queue dispatches, event emissions

4. **Business rules are the most important output.** A manifest with accurate business rules is far more valuable than one with complete endpoint coverage but generic descriptions. When in doubt, spend more time reading service-layer code to find conditional logic. Describe each rule in specific terms with actual thresholds, field names, and conditions -- not vague summaries.

5. For outbound calls, try to resolve the target:
   - Check config files, environment variable names, service registries
   - Check Kubernetes manifests, Docker Compose, or similar orchestration config
   - If the URL is in an env var like `ORDER_SERVICE_URL`, the target is likely `order-service`
   - If unresolvable, set `target: unknown` and note what you found in the condition field

6. Mark endpoints `confidence: low` if:
   - You couldn't trace through to the response (too many layers of abstraction)
   - The handler delegates to a complex class hierarchy you couldn't fully follow
   - Key business logic is in a dependency you don't have access to

### Pass 2.5: Business Rule Audit

After completing Pass 2 for all endpoints, do a targeted review:

1. For each endpoint that has **zero business rules**, re-read the service-layer code it calls. Most endpoints that write data have at least one conditional. If you genuinely find none, that's fine -- but an endpoint like `POST /orders` with no business rules is a red flag that you read too shallowly.
2. For each business rule you captured, verify it includes **specific values** (dollar amounts, status names, role names, thresholds) rather than vague descriptions. "Orders require approval" is too vague. "Orders over $500 require manager approval" is correct.
3. Check shared service classes, base classes, and traits/mixins that multiple endpoints use. Business rules in shared code often get missed because they're not in the endpoint's direct call chain.

### Pass 3: Cross-Cutting Concerns

Search for things not reachable via endpoint tracing:

1. **Events**: grep for Kafka producer/consumer setup, queue job dispatches, webhook registrations, event listener registrations
2. **Scheduled jobs**: cron definitions, scheduler configurations, periodic task registrations
3. **Middleware with business logic**: auth middleware that affects data flow, rate limiting rules, feature flag checks that alter behavior
4. **Background workers**: queue consumers, long-running processes

For each, determine if it introduces new data flows or business rules not already captured by endpoint tracing.

### Pass 4: Assembly

**IMPORTANT: Write the manifest incrementally, not all at once.** Large services produce manifests that exceed output token limits. Use the following chunked approach:

1. **Write the header and start the file:**
   Write `<service-name>.yaml` with the `schema_version`, `service` block, and `endpoints:` key. Leave the file open for appending.

2. **Write endpoints in chunks:**
   Append endpoints to the file in groups of 5-10. Each write appends a batch of endpoint entries under the `endpoints:` array. Do NOT try to write all endpoints in a single operation.

3. **Write remaining sections:**
   After all endpoints are written, append each remaining section as a separate write operation:
   - `outbound_calls:` (if any)
   - `data_models:` (if any)
   - `business_rules:` (if any, service-wide rules extracted from multiple endpoints)
   - `events:` (if any)

4. Deduplicate: if an outbound call was discovered both via endpoint tracing and event scanning, keep one entry
5. Extract service-wide business rules that apply to multiple endpoints into the top-level `business_rules` list
6. Order endpoints by path alphabetically, then by HTTP method
7. After the file is fully written, **read it back** and verify it is valid YAML. Fix any formatting issues (indentation, missing colons, etc.).
8. **Interactive mode:** Present a summary to the user:
   > "Discovered N endpoints, M outbound calls, K data models, J events. L endpoints marked confidence: low. Review the output at `<path>`."
   **Headless mode:** Write the file silently. Log a one-line summary to stdout for pipeline consumption.

## Important Notes

- Do NOT read every file in the repo. Start from routes and trace only reachable code.
- Do NOT include test files, migration files, or seed data in the analysis.
- Do NOT include infrastructure endpoints (health checks, metrics) unless they have business logic.
- If a file is very large (>500 lines), read only the relevant sections using offset/limit.
- The manifest should capture what the service DOES, not how it's built. A product manager should be able to read the `description` and `business_rules` fields and understand the service.
