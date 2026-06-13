# Roadmap

This roadmap is subject to change. We plan to deliver features in the order listed below, but priorities shift based on user feedback.

## Next (1.1)

- **Webhook Execution Endpoints** (Q3 2026): wire the existing webhook management UI to a live execution path that triggers a workflow run.
- **Secrets Management Runtime Resolution** (Q3 2026): resolve `{{secrets.NAME}}` placeholders at runtime so secret values flow into HTTP, assertion, and extractor nodes.
- **User Authentication (OAuth/OIDC)** (Q4 2026): add multi-user sign-in with an external identity provider for shared and hosted deployments.

## Later (1.2+)

- CI/CD CLI tool (`apiweave-cli`) for pipeline-driven runs.
- App settings page for workspace-level configuration.
- Workflow-environment UI association (browse and assign environments from the canvas).
- Expanded automated test coverage with CI gating.

## How to influence

Open or comment on a [GitHub Issue](https://github.com/apiweave/apiweave/issues) with your use case. The roadmap above shifts toward the work the community asks for first.
