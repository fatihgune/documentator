# Documentator

AI-powered living documentation for microservice architectures. Analyzes codebases, produces a structured YAML knowledge base, and keeps it current with a nightly update pipeline.

## What It Does

1. **Discovers** each service's endpoints, business rules, data models, and external calls
2. **Links** services into cross-service business flows (e.g., "Place Order" across 5 microservices)
3. **Updates** the knowledge base nightly by detecting changes and re-analyzing only what changed
4. **Serves** as a queryable documentation layer -- ask questions, get answers in business language

The knowledge base is optimized for LLM consumption. A fast, cheap model reading it answers documentation questions more accurately than an expensive model navigating raw codebases.

## Quick Start

### Prerequisites

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with AWS Bedrock access
- Git

### Install

```bash
git clone <repo-url>
cd documentator
npm install
```

### Discover a Service

```bash
cd ~/repos/order-service
claude
> /discover
```

This produces an `order-service.yaml` manifest. Copy it to your knowledge base repo under `services/`.

### Link Services Into Flows

```bash
cd ~/knowledge-base
claude
> /link
```

Reads all manifests in `services/`, generates flow files in `flows/`, and writes `index.yaml`.

### Query the Knowledge Base

```bash
cd ~/knowledge-base
claude
> How does the order approval process work?
```

The model reads `index.yaml`, loads relevant manifests and flows, and answers in business language.

## Setting Up Nightly Updates

### 1. Add config to your knowledge base repo

Create `documentator.config.yaml`:

```yaml
notification_hook: ./hooks/notify.sh
pr_auto_merge: true
claude_model: sonnet
```

### 2. Add CI workflow

Copy the appropriate example from `examples/` into your knowledge base repo:

- `github-actions-nightly.yml` for GitHub Actions
- `bitbucket-pipelines.yml` for Bitbucket Pipelines

### 3. What happens each night

The pipeline clones all tracked repos, detects which have changes, triages the affected manifest sections, re-discovers only the changed code paths, re-links flows, and opens an auto-merging PR.

Infrastructure-level changes (dependency bumps, Dockerfile, migrations) automatically trigger a full re-discover for that repo.

## Validating Knowledge Base Files

```bash
npx tsx src/validate.ts services/order-service.yaml
```

Validates any knowledge base file (manifest, flow, or index) against the JSON Schema.

## Running Tests

```bash
npm test
```

## Project Structure

```
src/schemas/       JSON Schema definitions
src/validate.ts    Schema validation (library + CLI)
src/nightly/       Nightly update pipeline
src/audit/         Accuracy audit tool
skills/            Claude Code skills (discover, link)
adapters/          Git provider adapters (GitHub, Bitbucket)
examples/          CI workflow examples
templates/         Knowledge base repo template
```

## Documentation

- [Architecture](docs/architecture.md) -- full system design, pipeline stages, design decisions
- [v1 Design Spec](docs/superpowers/specs/2026-03-25-documentator-v1-design.md) -- knowledge base schema, discovery, linking
- [Nightly Pipeline Spec](docs/superpowers/specs/2026-03-26-nightly-update-pipeline-design.md) -- update pipeline design

## License

Private.
