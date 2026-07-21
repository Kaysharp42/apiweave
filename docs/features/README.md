# Features

*Detailed feature documentation for APIWeave. The pages in this category follow a natural user journey: build workflows on the canvas and pass data between steps, configure the environment and the project that groups the workflows, then integrate with local tooling through the MCP bridge and OpenAPI or Swagger import.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the vocabulary of projects, workflows, variables, environments, secrets, and runs used throughout the feature guides.

## Execution

The two guides in this section cover the canvas itself and the data that flows between steps on a single run.

- [Workflows and Nodes](workflows-and-nodes.md): build, edit, and run workflows on the canvas. Covers every node type, canvas actions, resume behavior after a failed run, and keyboard shortcuts.
- [Variables and Extractors](variables-and-extractors.md): pass data between steps with the four placeholder namespaces, pull values from responses with extractors, and manage workflow-level variables.

## Configuration

These pages cover the per-environment values a workflow reads at run time, the project that groups workflows, and the secret store that holds the values `{{secrets.NAME}}` resolves to.

- [Environments and Secrets](environments-and-secrets.md): local environments, the encrypted secret store, and the metadata-only display.
- [Projects](projects.md): ordered groups of workflows that run together. Covers project lifecycle, `.awecollection` export and import, and the references-only behavior of the bundle.

## Integration

The two guides in this section cover the surfaces APIWeave exposes to other tools on your machine, whether that is a local AI agent or an upstream API definition.

- [MCP Integration](mcp-integration.md): drive APIWeave from AI agents through the Model Context Protocol. Covers the local loopback HTTP bridge, the per-install static token, and setup recipes for five major agents.
- [Swagger and OpenAPI Import](swagger-import.md): turn an OpenAPI or Swagger document into reusable request templates, with environment-linked sync, one-time file import, and the `Check API` warning badge.

## Related

- [Documentation Hub](../README.md)
- [Concepts](../getting-started/concepts.md)
