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
