# APIWeave Documentation Hub

*The entry point for every user-facing doc in APIWeave. Pick the path that matches your goal below, then follow the category index for the docs in that area.*

## Prerequisites

None. This page is the navigation hub. If you have not installed APIWeave yet, the first path below starts with the install guide.

## Where Do I Start?

Three paths cover almost every reason a person opens these docs. Pick the one that matches your goal.

**I want to USE APIWeave (install, run, build a workflow).**

Start with installation, build your first workflow, then read the concepts glossary when a term is new.

1. [Installation](getting-started/installation.md): one-shot quick start, manual, or Docker Compose.
2. [Your First Workflow](getting-started/first-workflow.md): build and run a workflow in five minutes.
3. [Concepts](getting-started/concepts.md): glossary of every term used in the rest of the docs.

**I want to BUILD with APIWeave (a specific feature).**

Jump straight to the feature guide. Each one is self-contained: concepts, prerequisites, worked examples, and troubleshooting for that feature.

- [Workflows and Nodes](features/workflows-and-nodes.md): canvas, the six node types, resume after a failed run.
- [Variables and Extractors](features/variables-and-extractors.md): pass data between nodes with the four placeholder namespaces.
- [Environments and Secrets](features/environments-and-secrets.md): dev/stage/prod variables, secret keys, what is wired in 1.0.
- [Collections](features/collections.md): run workflows in order as a portable `.awecollection` bundle.
- [Webhooks](features/webhooks.md): trigger runs from CI/CD with token and HMAC auth.
- [MCP Integration](features/mcp-integration.md): drive APIWeave from AI coding agents over the Model Context Protocol.
- [Swagger and OpenAPI Import](features/swagger-import.md): turn a spec into reusable request templates.

**I'm having trouble (something broke or behaves wrong).**

Use the central FAQ first, then the troubleshooting section in the relevant feature doc. Architecture is the right place when the failure spans services.

1. [Central FAQ and Troubleshooting](operations/troubleshooting.md): the "why does it do that" questions.
2. The Troubleshooting section in the matching [feature guide](#features) below for symptom-to-fix Q&A.
3. [Architecture](reference/architecture.md): how the pieces fit together when a failure spans services.

## Getting Started

Three docs that take a new user from zero to a working workflow. Read in order the first time, jump in by name after that.

- [Getting Started Index](getting-started/README.md)
- [Installation](getting-started/installation.md): pick the one-shot quick start, manual path, or Docker Compose.
- [Your First Workflow](getting-started/first-workflow.md): build and run a workflow against a public test endpoint.
- [Concepts](getting-started/concepts.md): short definitions for every term used in the rest of the docs.

## Features

The seven feature guides cover everything you can do with APIWeave. Each is a self-contained tutorial with worked examples and a troubleshooting section.

- [Features Index](features/README.md)
- [Workflows and Nodes](features/workflows-and-nodes.md): canvas, the six node types, toolbar actions, resume after a failed run.
- [Variables and Extractors](features/variables-and-extractors.md): the four placeholder namespaces and how to pull values from responses.
- [Environments and Secrets](features/environments-and-secrets.md): environment CRUD, variables, secret keys, what is and is not wired in 1.0.
- [Collections](features/collections.md): group workflows, ordered execution, `.awecollection` export/import.
- [Webhooks](features/webhooks.md): manage webhooks, token and HMAC auth, CI/CD snippets.
- [MCP Integration](features/mcp-integration.md): the Model Context Protocol server, supported transports, tool surface.
- [Swagger and OpenAPI Import](features/swagger-import.md): two import paths, supported versions, refresh behavior.

## Operations

The four operations guides cover production posture: auth, security, deployment, and the central FAQ. Read [Security](operations/security.md) and [Authentication](operations/authentication.md) before exposing the platform to anyone outside your laptop.

- [Operations Index](operations/README.md)
- [Authentication](operations/authentication.md): SSO model, local admin bootstrap, session policy, approved domains.
- [Security](operations/security.md): production security model and deployment guardrails.
- [Deployment](operations/deployment.md): self-hosting, the four runtime components, pre-production checklist.
- [Central FAQ and Troubleshooting](operations/troubleshooting.md): conceptual "why" questions for the whole system.

## Reference

The five reference pages are lookup tables and tours, not tutorials. Use them when you need the exact syntax, the full list, or a map of the surface area.

- [Reference Index](reference/README.md)
- [Architecture](reference/architecture.md): how the components fit together and how a run moves through the system.
- [Placeholders](reference/placeholders.md): the five placeholder namespaces and the substitution order.
- [Dynamic Functions](reference/dynamic-functions.md): the 13 functions callable inside placeholders.
- [Environment Variables](reference/environment-variables.md): every backend and frontend variable, with defaults.
- [API Reference](reference/api.md): short tour of the HTTP endpoints.

## What Goes Where

A one-line guide for picking the right category when a question comes up.

- **Getting started**: install, first run, vocabulary. Read in order on day one.
- **Features**: how to do one specific thing. Self-contained tutorials with worked examples.
- **Operations**: how to run in production. Auth, security, deployment, central FAQ.
- **Reference**: lookup tables and tours. Exact syntax, full lists, surface-area maps.

If you have a goal ("I want to..."), start in **Features**. If you have a question ("How does...?" or "Why does...?"), start in **Reference** or **Operations**. If you have not installed yet, start in **Getting started**.

## Troubleshooting

- **If a link in this hub breaks**, the doc has moved. Open the category index for that topic and pick the closest match by name.
- **If you cannot find a feature**, the most likely place is `features/`. Skim the [Features Index](features/README.md) before searching further.
- **If a behavior is unexpected**, the [Central FAQ](operations/troubleshooting.md) covers the "why" questions. For symptom-to-fix Q&A, the Troubleshooting section in the matching feature doc is faster.
- **If a failure spans services**, read [Architecture](reference/architecture.md) to see which component owns the step that failed.

## Related

- [Project README](../README.md)
- [Documentation Template](.template.md)
