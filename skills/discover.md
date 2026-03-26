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
