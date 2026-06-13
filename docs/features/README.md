# Features

*Detailed feature documentation for APIWeave. The pages in this category follow a natural user journey: build workflows and pass data between steps, configure the environment and group workflows into collections, then integrate with external systems through webhooks, the MCP server, and OpenAPI or Swagger import.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the vocabulary of workflows, nodes, variables, environments, and runs used throughout the feature guides.

## Execution

The two guides in this section cover the canvas itself and the data that flows between steps on a single run.

- [Workflows and Nodes](workflows-and-nodes.md): build, edit, and run workflows on the canvas. Covers every node type, canvas actions, resume behavior after a failed run, and keyboard shortcuts.
- [Variables and Extractors](variables-and-extractors.md): pass data between steps with the four placeholder namespaces, pull values from responses with extractors, and manage workflow-level variables.

## Configuration

These pages cover the per-environment values a workflow reads at run time and the grouping that turns individual workflows into a release-ready bundle.

- [Environments and Secrets](environments-and-secrets.md): create environments, declare variables, attach them to workflows, and learn the current limits of secret resolution in 1.0.
- [Collections](collections.md): group workflows into ordered runs with a shared failure policy. Covers collection lifecycle, export to `.awecollection`, import, and dry-run validation.

## Integration

The three guides in this section cover the surfaces APIWeave exposes to other systems, whether that system is a CI/CD pipeline, an AI agent, or an upstream API definition.

- [Webhooks](webhooks.md): trigger workflow and collection runs from external systems with token and HMAC authentication, idempotency, rate limiting, and CI/CD snippets for GitHub Actions, GitLab CI, and Jenkins.
- [MCP Integration](mcp-integration.md): drive APIWeave from AI agents through the Model Context Protocol. Covers both transports, the full tool surface, setup recipes for five major agents, and the secret policy.
- [Swagger and OpenAPI Import](swagger-import.md): turn an OpenAPI or Swagger document into reusable request templates, with environment-linked sync, one-time file import, the `Check API` warning badge, and the supported spec versions.

## Related

- [Documentation Hub](../README.md)
- [Navigation Guide](../NAVIGATION.md)
- [Concepts](../getting-started/concepts.md)
