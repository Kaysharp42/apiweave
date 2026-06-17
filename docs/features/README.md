# Features

*Detailed feature documentation for APIWeave 2.0. The pages in this category follow a natural user journey: build workflows inside a workspace and pass data between steps, configure the scoped environment and the project that groups the workflows, then integrate with external systems through webhooks, the MCP server, and OpenAPI or Swagger import.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the vocabulary of organizations, workspaces, projects, workflows, variables, environments, secrets, and runs used throughout the feature guides.

## Execution

The two guides in this section cover the canvas itself and the data that flows between steps on a single run.

- [Workflows and Nodes](workflows-and-nodes.md): build, edit, and run workflows inside a workspace. Covers every node type, canvas actions, resume behavior after a failed run, and keyboard shortcuts.
- [Variables and Extractors](variables-and-extractors.md): pass data between steps with the four placeholder namespaces, pull values from responses with extractors, and manage workflow-level variables.

## Configuration

These pages cover the per-workspace values a workflow reads at run time, the project that groups workflows, and the override chain that turns a `{{secrets.NAME}}` placeholder into a value.

- [Environments and Secrets](environments-and-secrets.md): scoped environments, the Libsodium write-only secret model, the override chain, and the metadata-only display.
- [Projects](projects.md): workspace-scoped, ordered groups of workflows that run together. Covers project lifecycle, `.awecollection` v2 export and import, and the references-only behavior of the bundle.

## Integration

The three guides in this section cover the surfaces APIWeave exposes to other systems, whether that system is a CI/CD pipeline, an AI agent, or an upstream API definition.

- [Webhooks](webhooks.md): trigger workflow and project runs from external systems with token and HMAC authentication, idempotency, rate limiting, and CI/CD snippets for GitHub Actions, GitLab CI, and Jenkins.
- [MCP Integration](mcp-integration.md): drive APIWeave from AI agents through the Model Context Protocol. Covers both transports, the rebuilt scoped tool surface, scoped service tokens, and setup recipes for five major agents.
- [Swagger and OpenAPI Import](swagger-import.md): turn an OpenAPI or Swagger document into reusable request templates inside a workspace, with environment-linked sync, one-time file import, the `Check API` warning badge, and the supported spec versions.

## Related

- [Documentation Hub](../README.md)
- [Concepts](../getting-started/concepts.md)
