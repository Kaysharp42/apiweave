# Features

*Detailed feature documentation for APIWeave. The pages in this category follow a natural user journey: build workflows on the canvas and pass data between steps, configure the environment and the project that groups the workflows, then integrate with local tooling through embedded coding agents, the MCP bridge, and OpenAPI or Swagger import.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the vocabulary of projects, workflows, variables, environments, secrets, and runs used throughout the feature guides.

## Learning

The in-app guide to the rest of the product, readable offline and independent of any workflow.

- [In-App Tutorials](tutorials.md): open the bundled library, search lessons, track completion, and follow along while you build.

## Execution

These guides cover the canvas itself, the data that flows between steps on a run, and the tools for running and debugging it.

- [Workflows and Nodes](workflows-and-nodes.md): build, edit, and run workflows on the canvas. Covers every node type — including the Call Workflow node that runs another workflow as one step and the expected-status control for negative tests — canvas actions, and keyboard shortcuts.
- [Variables and Extractors](variables-and-extractors.md): pass data between steps with the four placeholder namespaces, pull values from responses with extractors, and manage workflow-level variables.
- [Scripting](scripting.md): pre-request and post-response JavaScript on an HTTP Request node, run in a sandbox, to sign requests, transform values into variables and write custom tests.
- [Load Runs](load-runs.md): run a workflow many times in parallel and report per-step latency percentiles, throughput and threshold gates, in the app or with `apiweave run --concurrency`.
- [Data-Driven Runs](data-driven-runs.md): run a workflow once per row of a CSV or JSON file, in the app or with `apiweave run --iteration-data`, reading each row as `{{data.<column>}}`.
- [Node Presets](node-presets.md): save a node's configuration under a name and drag it into any workflow in the workspace. Covers saving, renaming, deleting, and what a preset does and does not carry.
- [Visualization and Debugging](visualization-and-debugging.md): run timeline/waterfall, variable provenance tracing, masked-secret resolution confidence, and camera-follow during runs — read-only debugging views over existing run and dataflow data.

## Configuration

These pages cover the per-environment values a workflow reads at run time, the project that groups workflows, and the secret store that holds the values `{{secrets.NAME}}` resolves to.

- [Environments and Secrets](environments-and-secrets.md): local environments, environment inheritance for shared variables, the encrypted secret store, and the metadata-only display.
- [Network](network.md): Settings > Network — a proxy, trusted certificate authorities (including the operating system's store) and client certificates for mutual TLS, for every request.
- [Projects](projects.md): ordered groups of workflows. Covers project lifecycle, `.aweproject` export and import, and the references-only behavior of the bundle.

## Integration

These guides cover how APIWeave works with other tools on your machine: the coding agents it launches, the MCP server any local agent can drive it through, and upstream API definitions.

- [Coding Agents](coding-agents.md): launch an installed agent CLI (Claude Code, Codex CLI, Gemini CLI, OpenCode and others) beside the canvas, already connected to the MCP server and briefed on the workflow. Covers Settings → Agents, the dock, busy and idle status, Resume, external terminals, and keeping APIWeave running in the tray.
- [MCP Integration](mcp-integration.md): drive APIWeave from AI agents through the Model Context Protocol. Covers the local loopback HTTP bridge, the per-install bearer token (regenerable from Settings), and setup recipes for five major agents. See also [Giving the agent a map of your code](mcp-integration.md#giving-the-agent-a-map-of-your-code) for graphify-based code maps.
- [Swagger and OpenAPI Import](swagger-import.md): turn an OpenAPI or Swagger document into reusable request templates, with environment-linked sync, one-time file import, and the `Check API` warning badge.

## Related

- [Documentation Hub](../README.md)
- [Concepts](../getting-started/concepts.md)
