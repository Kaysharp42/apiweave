# APIWeave Documentation Hub

*The entry point for every user-facing doc in APIWeave 2.0. Pick the path that matches your goal below, then follow the category index for the docs in that area.*

## What APIWeave 2.0 Looks Like

APIWeave 2.0 is a GitHub-style multi-tenant platform. Every user gets a personal workspace on first sign-in. Organizations own one or more workspaces. Each workspace contains projects (ordered groups of workflows), scoped environments, scoped secrets, and service tokens. Runs select one environment explicitly, and `{{secrets.NAME}}` resolves through a scope override chain rather than a single active environment.

APIWeave ships with two operating models selected by `DEPLOYMENT_MODE` in `backend/.env`. **`multi_tenant`** (the default) is the full SSO + invites + organizations model described above, intended for hosted SaaS and team installs. **`single_user`** is a zero-configuration self-hosting mode for a single operator — no OAuth, no sessions, no logins; the canvas loads immediately with a synthetic owner. See the [Authentication guide](operations/authentication.md#deployment-mode) for the contract and the switching procedure.

If you have used the 1.0 release, the things that changed are spelled out in the [2.0 changelog entry](../CHANGELOG.md). The short version: collections are now projects, the global `isActive` environment flag is gone, runtime secret input is gone, and the flat `/api/*` routes are replaced by slug-based scoped paths.

## Prerequisites

None for this page. This is the navigation hub. If you have not installed APIWeave yet, the first path below starts with the install guide and the destructive database reset that the unreleased 2.0 line requires.

## Where Do I Start?

Three paths cover almost every reason a person opens these docs. Pick the one that matches your goal.

**I want to USE APIWeave (install, run, build a workflow).**

Start with installation, build your first workflow in your personal workspace, then read the concepts glossary when a term is new.

1. [Installation](getting-started/installation.md): one-shot quick start, manual, or Docker Compose, plus the destructive database reset.
2. [Your First Workflow](getting-started/first-workflow.md): build and run a workflow in your personal workspace in five minutes.
3. [Concepts](getting-started/concepts.md): glossary of every term used in the rest of the docs (organization, workspace, project, environment, scope).

**I want to BUILD with APIWeave (a specific feature).**

Jump straight to the feature guide. Each one is self-contained: concepts, prerequisites, worked examples, and troubleshooting for that feature.

- [Workflows and Nodes](features/workflows-and-nodes.md): canvas, the six node types, toolbar actions, resume after a failed run, and the workspace context that every workflow lives in.
- [Variables and Extractors](features/variables-and-extractors.md): the four placeholder namespaces and how to pull values from responses.
- [Projects](features/projects.md): project lifecycle, ordered execution, `.awecollection` v2 export and import (references only).
- [Environments and Secrets](features/environments-and-secrets.md): scoped environments, Libsodium write-only secret ingress, metadata-only display, the override chain, and the fact that runtime secret input is removed.
- [Webhooks](features/webhooks.md): scoped webhooks, machine-to-machine credentials, idempotency, rate limiting, and CI/CD integration.
- [MCP Integration](features/mcp-integration.md): scoped service tokens, both transports, and the rebuilt scoped tool surface.
- [Swagger and OpenAPI Import](features/swagger-import.md): turn a spec into reusable request templates inside a workspace.

**I'm having trouble (something broke or behaves wrong).**

Use the central FAQ first, then the troubleshooting section in the relevant feature doc. Architecture is the right place when the failure spans services.

1. [Central FAQ and Troubleshooting](operations/troubleshooting.md): the "why does it do that" questions.
2. The Troubleshooting section in the matching [feature guide](#features) below for symptom-to-fix Q&A.
3. [Architecture](reference/architecture.md): how the pieces fit together when a failure spans services.
4. [Audit Log](operations/audit.md): when the question is "who did what, when?".

## Getting Started

Three docs that take a new user from zero to a working workflow. Read in order the first time, jump in by name after that.

- [Getting Started Index](getting-started/README.md)
- [Installation](getting-started/installation.md): pick the one-shot quick start, manual path, or Docker Compose, then read the destructive reset section.
- [Your First Workflow](getting-started/first-workflow.md): build and run a workflow in your personal workspace against a public test endpoint.
- [Concepts](getting-started/concepts.md): short definitions for every term used in the rest of the docs.

## Features

The seven feature guides cover everything you can do with APIWeave. Each is a self-contained tutorial with worked examples and a troubleshooting section.

- [Features Index](features/README.md)
- [Workflows and Nodes](features/workflows-and-nodes.md): build, edit, and run workflows inside a workspace.
- [Variables and Extractors](features/variables-and-extractors.md): pass data between steps with the four placeholder namespaces.
- [Projects](features/projects.md): group workflows into ordered runs and export them as `.awecollection` v2 bundles.
- [Environments and Secrets](features/environments-and-secrets.md): scoped environments, scoped secrets, the override chain, and write-only secret ingress.
- [Webhooks](features/webhooks.md): scoped webhook credentials, idempotency, rate limiting, and CI/CD snippets.
- [MCP Integration](features/mcp-integration.md): scoped service tokens, both transports, and the scoped tool surface.
- [Swagger and OpenAPI Import](features/swagger-import.md): two import paths, supported versions, refresh behavior.

## Operations

The six operations guides cover production posture: authentication, security, deployment, environment protection, audit, and the central FAQ.

- [Operations Index](operations/README.md)
- [Authentication](operations/authentication.md): SSO model, organization and workspace context, invite flow.
- [Security](operations/security.md): production security model, scoped trust boundaries, and deployment guardrails.
- [Encryption](operations/encryption.md): per-scope Libsodium keypairs, the master KEK, write-only secret model, and keyring rotation.
- [Deployment](operations/deployment.md): self-hosting, environment variables, the destructive database reset on upgrade, and the pre-production checklist.
- [Environment Protection](operations/environment-protection.md): required reviewers, self-approval, and the trusted-token bypass.
- [Audit Log](operations/audit.md): the append-only event log, filters, and the JSON export.
- [Central FAQ and Troubleshooting](operations/troubleshooting.md): conceptual "why" questions for the whole system.

## Reference

The five reference pages are lookup tables and tours, not tutorials. Use them when you need the exact syntax, the full list, or a map of the surface area.

- [Reference Index](reference/README.md)
- [Architecture](reference/architecture.md): how the components fit together and how a run moves through the system.
- [Placeholders](reference/placeholders.md): the four placeholder namespaces, the override chain, and the substitution order.
- [Dynamic Functions](reference/dynamic-functions.md): the 13 functions callable inside placeholders.
- [Environment Variables](reference/environment-variables.md): every backend and frontend variable, with defaults.
- [API Reference](reference/api.md): short tour of the scoped HTTP endpoints and the MCP group.

## What Goes Where

A one-line guide for picking the right category when a question comes up.

- **Getting started**: install, first run, vocabulary. Read in order on day one.
- **Features**: how to do one specific thing. Self-contained tutorials with worked examples.
- **Operations**: how to run in production. Auth, security, deployment, environment protection, audit, central FAQ.
- **Reference**: lookup tables and tours. Exact syntax, full lists, surface-area maps.

If you have a goal ("I want to..."), start in **Features**. If you have a question ("How does...?" or "Why does...?"), start in **Reference** or **Operations**. If you have not installed yet, start in **Getting started**.

## Troubleshooting

- **If a link in this hub breaks**, the doc has moved. Open the category index for that topic and pick the closest match by name.
- **If you cannot find a feature**, the most likely place is `features/`. Skim the [Features Index](features/README.md) before searching further.
- **If a behavior is unexpected**, the [Central FAQ](operations/troubleshooting.md) covers the "why" questions. For symptom-to-fix Q&A, the Troubleshooting section in the matching feature doc is faster.
- **If a failure spans services**, read [Architecture](reference/architecture.md) to see which component owns the step that failed.
- **If you need to know who did what**, read the [Audit Log](operations/audit.md) guide and use the export to take a snapshot.

## Related

- [Project README](../README.md)
- [Changelog](../CHANGELOG.md)
- [Documentation Template](.template.md)
