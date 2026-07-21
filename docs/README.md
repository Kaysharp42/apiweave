# APIWeave Documentation Hub

*The entry point for every user-facing doc in APIWeave. Pick the path that matches your goal below, then follow the category index for the docs in that area.*

## What APIWeave Looks Like

APIWeave is a local-first desktop app. There is no server to run, no cloud account to create, no login screen, no deployment to plan. You download the installer, run it, and the app opens straight into the canvas. Everything — workflows, environments, secrets, run history — lives on your machine in a single SQLite database under your user data directory.

Work is organized locally into **orgs and teams**: an org is the top-level container for your APIWeave work, and a team is a group inside an org that shares workflows, environments, and projects. Orgs and teams are a local structure on *this machine*. No account is required, and everything stays on your computer by default.

Optional APIWeave Cloud sync and collaboration turn on when you sign in with an optional Cloud account. Cloud syncs test structure (workflows, environments, projects, and secret references) and lets multiple machines collaborate in shared Cloud Workspaces; secret values and run history stay local and are rejected from sync payloads. The local and Cloud names map: a desktop **org** corresponds to a Cloud **Team**, and a desktop **team** corresponds to a Cloud **Workspace**. Cloud never builds or runs tests — all execution stays on the desktop.

There is no SSO, no webhooks, and no remote trigger. You run a workflow by clicking **Run** in the app, by scheduling it locally, or by having a local AI agent drive the app through the loopback MCP bridge.

If you have used an earlier web build of APIWeave, the things that changed are spelled out in the [changelog](../CHANGELOG.md). The short version: no login required, no hosted backend, no webhooks, no public ports. The canvas, the variables, the environments, the projects, the secret store, and the MCP integration are all the same shape they were before. An optional Cloud account adds sync and collaboration across machines, but the desktop app is fully usable without it.

## Prerequisites

None for this page. This is the navigation hub. If you have not installed APIWeave yet, the first path below starts with the install guide.

## Where Do I Start?

Three paths cover almost every reason a person opens these docs. Pick the one that matches your goal.

**I want to USE APIWeave (install, run, build a workflow).**

Start with installation, build your first workflow, then read the concepts glossary when a term is new.

1. [Installation](getting-started/installation.md): download the installer, run it, open the app.
2. [Your First Workflow](getting-started/first-workflow.md): build and run a workflow in five minutes.
3. [Concepts](getting-started/concepts.md): glossary of every term used in the rest of the docs (workflow, node, environment, secret, run).

**I want to BUILD with APIWeave (a specific feature).**

Jump straight to the feature guide. Each one is self-contained: concepts, prerequisites, worked examples, and troubleshooting for that feature.

- [Workflows and Nodes](features/workflows-and-nodes.md): canvas, the six node types, toolbar actions, resume after a failed run.
- [Variables and Extractors](features/variables-and-extractors.md): the four placeholder namespaces and how to pull values from responses.
- [Projects](features/projects.md): ordered groups of workflows, project runs, and `.awecollection` export and import (references only).
- [Environments and Secrets](features/environments-and-secrets.md): local environments, the encrypted secret store, and the metadata-only display.
- [MCP Integration](features/mcp-integration.md): the local loopback HTTP bridge for AI agents on the same machine.
- [Swagger and OpenAPI Import](features/swagger-import.md): turn a spec into reusable request templates.

**I'm having trouble (something broke or behaves wrong).**

Use the central FAQ first, then the troubleshooting section in the relevant feature doc. Architecture is the right place when the failure spans processes.

1. The Troubleshooting section in the matching [feature guide](#features) below for symptom-to-fix Q&A.
2. [Architecture](reference/architecture.md): how the pieces fit together when a failure spans the renderer and the main process.

## Getting Started

Three docs that take a new user from zero to a working workflow. Read in order the first time, jump in by name after that.

- [Getting Started Index](getting-started/README.md)
- [Installation](getting-started/installation.md): download the installer, run it, open the app.
- [Your First Workflow](getting-started/first-workflow.md): build a five-step workflow against a public test endpoint.
- [Concepts](getting-started/concepts.md): short definitions for every term used in the rest of the docs.

## Features

The six feature guides cover everything you can do with APIWeave. Each is a self-contained tutorial with worked examples and a troubleshooting section.

- [Features Index](features/README.md)
- [Workflows and Nodes](features/workflows-and-nodes.md): build, edit, and run workflows on the canvas.
- [Variables and Extractors](features/variables-and-extractors.md): pass data between steps with the four placeholder namespaces.
- [Projects](features/projects.md): group workflows into ordered runs and export them as `.awecollection` bundles.
- [Environments and Secrets](features/environments-and-secrets.md): local environments, the encrypted secret store, and the metadata-only display.
- [MCP Integration](features/mcp-integration.md): the loopback HTTP bridge for local AI agents.
- [Swagger and OpenAPI Import](features/swagger-import.md): import endpoints from a spec.

## Reference

The five reference pages are lookup tables and tours, not tutorials. Use them when you need the exact syntax, the full list, or a map of the surface area.

- [Reference Index](reference/README.md)
- [Architecture](reference/architecture.md): how the components fit together and how a run moves through the system.
- [Placeholders](reference/placeholders.md): the four placeholder namespaces and the substitution order.
- [Dynamic Functions](reference/dynamic-functions.md): the functions callable inside placeholders.
- [Environment Variables](reference/environment-variables.md): every Vite variable the renderer reads, with defaults.
- [IPC API](reference/api.md): the typed IPC handler registry the renderer and the local MCP bridge call.

## What Goes Where

A one-line guide for picking the right category when a question comes up.

- **Getting started**: install, first run, vocabulary. Read in order on day one.
- **Features**: how to do one specific thing. Self-contained tutorials with worked examples.
- **Reference**: lookup tables and tours. Exact syntax, full lists, surface-area maps.

If you have a goal ("I want to..."), start in **Features**. If you have a question ("How does...?" or "Why does...?"), start in **Reference**. If you have not installed yet, start in **Getting started**.

## Troubleshooting

- **If a link in this hub breaks**, the doc has moved. Open the category index for that topic and pick the closest match by name.
- **If you cannot find a feature**, the most likely place is `features/`. Skim the [Features Index](features/README.md) before searching further.
- **If a behavior is unexpected**, the Troubleshooting section in the matching feature doc covers symptom-to-fix Q&A.
- **If a failure spans processes** (the renderer and the main process), read [Architecture](reference/architecture.md) to see which component owns the step that failed.

## Related

- [Project README](../README.md)
- [Changelog](../CHANGELOG.md)
- [Documentation Template](.template.md)
