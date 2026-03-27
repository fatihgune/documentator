---
name: documentator:link
description: Read all service manifests in a Documentator knowledge base and produce cross-service flow traces. Run this in the root of a knowledge base repository after all services have been discovered.
---

# Documentator: Link Services Into Flows

You are reading a collection of service manifests (produced by `/documentator:discover`) and building **cross-service flow files** that trace how features work end-to-end across multiple services. You also produce an **index file** that serves as a table of contents for the entire knowledge base.

## Critical Rules

1. **Flows must span 2+ services.** Single-service operations are already documented in the service manifest. Flows capture what crosses boundaries.
2. **Name by business outcome.** "Place Order" not "frontend-gateway-order-inventory-comms". The name should be something a product manager would recognize.
3. **Include branching logic.** If a flow has conditional paths (different behavior for different order amounts, customer types, etc.), document ALL branches.
4. **Don't load everything at once.** Read manifests in small groups as you trace connections. A flow touching 4 services needs only those 4 manifests loaded.
5. **Flag unresolved connections.** If a service calls `target: unknown`, note this in the flow as a gap.

## Modes

### Interactive Mode (default)

The standard mode when run by a developer. Presents connection graph summary, flow list, and gap analysis for review.

### Headless Mode (`--headless`)

Used by the nightly update pipeline. Differences from interactive mode:
- **No summaries or prompts.** Write all output files directly.
- **Log to stdout.** Print a one-line JSON summary for pipeline consumption: `{"flows_written": N, "flows_updated": M, "unresolved": K}`
- **Incremental by default.** When flow files already exist, detect which flows are affected by manifest changes and only regenerate those. Unaffected flows are left untouched.

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

**Interactive mode:** After generating all flows, report:

1. **Isolated services**: services with no inbound or outbound connections to other discovered services
2. **Dead-end outbound calls**: calls to services not in the knowledge base
3. **Orphan events**: published events with no discovered consumer, consumed events with no discovered publisher
4. **Single-service flows discarded**: entry points that didn't lead to cross-service flows (these are already in the service manifest)

Present this as a summary so the user knows what's missing and can discover additional repos to fill gaps.

**Headless mode:** Skip the interactive report. Include gap counts in the stdout JSON summary.

## Important Notes

- The flow name should make sense to someone who has never seen the code. "Custom Order Processing" is better than "POST /orders with custom flag handler".
- Sort flows in the index alphabetically within each domain.
- If a service appears in many flows (like a gateway or communication service), that's expected — don't try to reduce it.
- The index summaries should be concise (under 100 characters) and describe the business outcome, not the technical path.
