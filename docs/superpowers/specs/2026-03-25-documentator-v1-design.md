# Documentator v1 Design Spec

## Problem

Documentation in large organizations gets stale, is hard to maintain, inconsistent in quality, and expensive to keep current. Engineers and non-technical staff spend hours tracing code paths across multiple repositories to answer questions that should be instant.

## Solution

An AI-powered living documentation system. A structured knowledge base -- optimized for LLM consumption, not human reading -- is built from codebases and kept current through incremental updates. Users interact with it conversationally through Claude Code (developers) or a future web frontend (non-technical users).

The core insight: compress multi-repo tribal knowledge into an efficient retrieval format so a cheap, fast model (Haiku) can answer documentation questions faster and cheaper than an expensive model navigating raw codebases.

## Target Environment

- Large company organized into "tribes" (teams), each owning multiple repositories
- Microservice architectures: frontends, API gateways, backend services, communication services
- Tech stacks vary across tribes (Laravel, Kotlin, etc.)
- Claude Code available via AWS Bedrock
- Typical tribe: ~15 repos, ~10 developers, ~100 cross-service business flows

## v1 Scope

Three components:

1. **Knowledge base schema** -- the structured format for storing discovered knowledge
2. **Discovery skill** (`/discover`) -- one-off per-repo codebase analysis that produces a service manifest
3. **Linking agent** (`/link`) -- reads all service manifests and produces cross-service flow traces

Deferred to v2+:

- Incremental update pipeline (nightly agent or developer-triggered)
- Developer CLI convenience command (`documentator update`)
- Web frontend for non-technical users
- Retrieval optimization for very large knowledge bases

## Implementation Approach

Claude Code skills (Approach A). Zero infrastructure, ships fast, iterates on prompts directly. Core intelligence is in prompts and schema design, not application logic. Extraction to a standalone library/CLI deferred until the web frontend becomes a real need.

---

## Component 1: Knowledge Base Schema

### File Structure

```
knowledge-base/
  services/
    order-service.yaml
    inventory-service.yaml
    communication-service.yaml
    ...
  flows/
    orders/
      place-order.yaml
      cancel-order.yaml
      ...
    customers/
      onboarding.yaml
      ...
    billing/
      invoice-generation.yaml
      ...
  index.yaml
```

### Service Manifest (per repo)

One YAML file per discovered repo in `services/`. Contains:

- **identity**: service name, repo URL, tech stack detected, last discovered timestamp
- **endpoints**: each API endpoint with route (includes HTTP method), request/response shapes (data fields only, no framework types), business-language description, optional `confidence` marker (`low` when discovery couldn't fully trace the endpoint)
- **outbound_calls**: each external service call -- target service name, endpoint, data sent, conditions under which it fires
- **data_models**: core business entities (not ORM models) with fields and relationships
- **business_rules**: conditional logic that matters to the business ("orders over $500 require manager approval")
- **events**: published/consumed events (Kafka topics, webhooks, queue messages) with payload shapes

Schema design principle: the schema is tech-stack agnostic. It has no slots for framework-specific concepts (no Resource classes, no annotations, no ORM mappings). Framework boilerplate is filtered out during discovery by the nature of the output format, not by framework-specific rules.

#### Service Manifest Example

```yaml
schema_version: 1
service:
  name: order-service
  repo: github.com/company/order-service
  stack: laravel
  discovered: 2026-03-25T10:00:00Z

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
      customer_id?: string
      status?: string
      page?: number
    response:
      orders: Order[]
      total: number
    confidence: low

outbound_calls:
  - target: inventory-service
    endpoint: POST /reservations
    sends:
      items: Item[]
      order_id: string
    condition: "After order creation succeeds"
  - target: communication-service
    endpoint: POST /send
    sends:
      template: "order-confirmation"
      params:
        order_id: string
        customer_name: string
    condition: "After order status set to 'confirmed'"

data_models:
  - name: Order
    fields:
      order_id: string
      customer_id: string
      status: string (created | pending_approval | confirmed | cancelled)
      total: number
      items: Item[]
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

### Flow File (cross-service)

One YAML file per business flow in `flows/{domain}/`. Contains:

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

### Index File (table of contents)

`index.yaml` -- used by consuming LLMs for retrieval and by the update pipeline for triage.

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
    services: [frontend-checkout, api-gateway, order-service, inventory-service, communication-service]
  - name: Cancel Order
    file: flows/orders/cancel-order.yaml
    summary: "Order cancellation with inventory release and customer notification"
    services: [order-service, inventory-service, communication-service]
```

---

## Component 2: Discovery Skill (`/discover`)

A Claude Code skill that runs inside the target repository. Produces a service manifest YAML file.

### Invocation

```
cd ~/repos/order-service
claude
> /discover
```

### Process

The skill operates in sequential passes, each with bounded context:

**Pass 1 -- Orientation**

- Read project config files (package.json, composer.json, build.gradle, Dockerfile, etc.)
- Detect tech stack, entry points, project structure
- Read route/controller definitions to enumerate all endpoints
- Output: skeleton manifest with service identity and endpoint list

**Pass 2 -- Endpoint deep-dive**

- For each endpoint, trace the code path: controller/handler -> service layer -> external calls -> data access
- Extract request/response shapes, business rules, outbound calls
- Each endpoint processed independently to keep context bounded
- For services with 50+ endpoints: process in batches, optionally scoped by area (e.g., `/orders/*` routes only)

**Pass 3 -- Cross-cutting concerns**

- Event publishers/consumers (Kafka, queues, webhooks)
- Scheduled jobs and cron tasks
- Middleware that applies business logic (auth, rate limiting, feature flags)
- Background workers

**Pass 4 -- Assembly and validation**

- Merge all passes into the final service manifest YAML
- Validate against the schema
- Flag endpoints that produced thin results (marked with `confidence: low`)
- Present summary to developer for review

### Design Principles

- **Per-endpoint tracing, not whole-codebase summarization.** Follows code paths from endpoints, doesn't scan every file.
- **Business language, not code language.** "Describe what this does in terms a product manager would understand. Name the data fields, not the class names."
- **Explicit uncertainty.** Unresolvable outbound calls marked as `target: unknown` rather than guessed. Developer fills gaps during review.
- **Idempotent.** Running discovery twice on the same repo at the same commit produces the same output.
- **Tech-stack agnostic.** The skill detects the stack to understand framework conventions (what's boilerplate), but the output schema is the same regardless of stack.

### For large services

When a service has many endpoints (50+), the skill asks the developer:

> "This service has 83 endpoints. Discover all of them, or focus on a specific area?"
> - All endpoints (will process in batches)
> - Routes under a specific prefix (e.g., `/orders/*`)

Full runs process endpoints in batches to stay within context limits. Each batch produces partial results that are merged in Pass 4.

### Output

A single file `{service-name}.yaml` written to the current directory or a specified knowledge base path. Conforms to the service manifest schema.

---

## Component 3: Linking Agent (`/link`)

A Claude Code skill that runs in the knowledge base repo. Reads all service manifests and produces the flow layer.

### Invocation

```
cd ~/knowledge-base
claude
> /link
```

### Process

**Step 1 -- Build connection graph**

- Read all service manifests in `services/`
- Extract every outbound call and match to inbound endpoints on other services
- Produce a directed graph of service-to-service connections
- Flag unresolved connections (outbound calls to services not yet discovered)

**Step 2 -- Trace flows from entry points**

- Identify entry points: frontend services, gateway routes, event consumers with no upstream trigger
- Walk the connection graph from each entry point, following outbound call chains
- Each chain spanning 2+ services becomes a candidate flow
- Include branching paths (conditional logic from business rules)

**Step 3 -- Enrich with business context**

- For each candidate flow, pull business rules and conditions from service manifests along the path
- Assemble into a narrative with meaningful descriptions at each step
- Note failure modes and edge cases where documented

**Step 4 -- Name and categorize**

- Group flows by business domain (orders, billing, customers, etc.)
- Name each flow by what it accomplishes ("Place Order," not "frontend-gateway-order-inventory-comms")
- Deduplicate overlapping flows (flows that share most of their path)

**Step 5 -- Produce index**

- Generate `index.yaml` listing all services and flows with one-line summaries
- This file is used by consuming LLMs for retrieval and by the update pipeline for triage

### Context Management

The linking agent does not load all manifests at once. It loads manifests in small groups as it traces connections. A flow touching 4 services loads only those 4 manifests.

### Re-running

After any service manifest update, the linking agent can be re-run. It detects which flows are affected by comparing the connection graph before and after the update, and only re-processes those flows.

### Output

- Flow files in `flows/{domain}/{flow-name}.yaml`
- Updated `index.yaml`

---

## Future: Incremental Update Pipeline (v2)

Documented here for context, not part of v1 implementation.

### Nightly Automated Updates

A scheduled agent (GitHub Action on cron or similar) that:

1. Shallow-clones all repos in the tribe's collection
2. Collects the day's diffs (`git log --since="24 hours ago" -p`)
3. Feeds combined diffs to an LLM agent with the current knowledge base index

The update agent works in bounded stages:

- **Triage**: Load index + diffs. Determine which service manifests and flows are affected.
- **Per-service updates**: For each affected service, load that manifest + relevant diffs. Update manifest.
- **Flow updates**: For each affected flow, load that flow + referenced service manifests + diffs. Update flow.
- **New flow detection**: Check if changes introduce new cross-service paths. Create new flow files if so.

Each stage is a separate LLM call with focused context. No stage loads the full knowledge base.

Output: a PR against the knowledge base repo for human review.

### Developer-Triggered Updates

Optional convenience for immediate updates after shipping:

```
cd ~/tribe-workspace
documentator update
```

Auto-detects repos with changes since last knowledge base update, runs diff analysis across all changed repos simultaneously (solving the cross-repo context problem), and raises a PR.

---

## Future: Consumption Layer (v2+)

### Developer Consumption

Developers clone the knowledge base repo locally and use Claude Code to query it conversationally. The CLAUDE.md in the knowledge base repo instructs the model to:

1. Read `index.yaml` first
2. Load only relevant service manifests and flows based on the question
3. Answer in business language with specific data field names and conditions

### Non-Technical User Consumption

A lightweight web frontend that takes a question, loads relevant knowledge base files into an LLM call, and returns the answer. Details deferred until v2.

---

## Success Criteria

v1 is successful if:

1. The discovery skill produces accurate service manifests for at least two repos with different tech stacks (e.g., one Laravel, one Kotlin)
2. The linking agent correctly traces cross-service flows from the produced manifests
3. A developer can query the knowledge base via Claude Code and get accurate answers to questions like "how does field X on the orders page get its value?" without the LLM needing to read the original source code
4. A Haiku-class model can answer questions from the knowledge base accurately (validating the efficiency premise)

## Open Questions

1. **Schema evolution**: A `schema_version` field is included in manifests. Migration strategy for breaking changes TBD during v2 when real schema evolution pressure arises.
2. **Manual enrichment workflow**: When discovery produces `confidence: low` results, what's the developer workflow for filling gaps?
3. **Knowledge base repo permissions**: Should the knowledge base be one repo per tribe, or one central repo with directories per tribe?
4. **Flow granularity threshold**: At what point is a cross-service interaction too trivial to warrant its own flow file?
