# Compatibility and Deprecation Policy

*What APIWeave 1.x keeps stable for the things other people build against: local agents, checked-in workspace repositories, exported project bundles, and CI pipelines.*

APIWeave follows [Semantic Versioning](https://semver.org/): within 1.x, a release may add capability but does not break a documented contract below. A change that cannot be made additively waits for 2.0. This page is the public promise; it is deliberately narrower than everything the app does internally.

## Versioning in one paragraph

- **Major (2.0)** may remove or change any surface described here.
- **Minor (1.x)** may add tools, optional arguments, response fields, CLI flags and bundle features. Existing documented behaviour keeps working.
- **Patch (1.x.y)** fixes defects without changing a contract. Security fixes are the exception described under [Deprecation](#deprecation).

Only the latest release receives security fixes — see [SECURITY.md](../../SECURITY.md). The 0.x line carries no compatibility promise.

## MCP tool surface

The MCP tools listed by the local bridge are a public contract.

- **Names are stable.** A tool such as `workflows_get`, `runs_create` or `projects_export` is not renamed or removed in a 1.x release. A new tool may be added at any time.
- **Existing arguments are stable.** The name, type and meaning of a documented argument do not change in 1.x. New *optional* arguments may be added; a call that worked before continues to work without them.
- **Results are additive.** Existing documented fields keep their names, types and meaning. New fields may appear, and list or paging results may include more information. An agent should ignore fields it does not recognise rather than fail — that is what lets a client written for 1.0 read a later 1.x response.
- **Bounds may be raised, not lowered.** Where a tool documents a size or page limit, a later 1.x build may accept more, but a request that fit the documented limit keeps working.
- **Descriptions, prompts and guides may change.** They are documentation for the agent, not a machine contract. The guides themselves are versioned with the app.

Tool names are listed in `app/core/mcp/tools.ts` and the MCP integration guide ([MCP Integration](../features/mcp-integration.md)). The bridge's tool whitelist can grow; it never silently turns a renderer-only IPC handler into an agent tool.

## Workspace repository format

A workspace tracked in git is a directory whose `.apiweave/format.json` declares:

```json
{ "format": "apiweave-workspace", "version": 2 }
```

- **Version 2 is the 1.0 contract.** Every 1.x release writes version 2 and reads versions 1 and 2, so a repository committed by one 1.x build opens in any other. Version 1 is the pre-1.0 layout: it lacks `baseEnvironmentId` and node presets, and every environment extends none. Opening a version 1 repository and committing upgrades it to version 2.
- **The layout is stable.** `workspace.json`, `projects/`, `workflows/`, `environments/` and `presets/` keep their documented shape for the life of 1.x. The layout is described in [Keep Tests in a Git Repository](../guides/git-workflows.md).
- **A newer version is refused, not guessed at.** If a future release changes the format, it will use a new `version` number. A 1.x app that meets a higher version stops with a message telling the user to update, rather than reading or rewriting a tree it does not understand.
- **Running a repository is read-only.** `apiweave run` parses the files and leaves the checkout exactly as it found it; it never migrates a repository in place.

## `.awecollection` project bundles

A project bundle is a JSON file with `"type": "awecollection"` and `"schemaVersion": "2.0"`.

- **1.x exports `2.0` and imports `2.0`.** A bundle exported by any 1.x release imports into any other 1.x release.
- **Secret references only.** A bundle carries the names and scopes of secrets, never values, ciphertext or private keys. That is a security property, not a version-specific detail, and it does not change in 1.x.
- **`2.0` files remain readable throughout 1.x.** If the bundle shape needs a breaking change, it gets a new schema version in a major release. The importer warns when it sees a version it does not expect; do not rely on a newer bundle importing cleanly into an older app.
- **The import result may gain fields.** Reported warnings, counts and missing-secret information are additive.

## CLI

The headless runner is `apiweave run <path>` from the `@apiweave/cli` package (or `node dist/cli/apiweave.cjs` in a source checkout).

- **Documented flags and aliases are stable.** The options printed by `apiweave run --help` — for example `--project`, `-w/--workflow`, `-e/--env`, `--secret`, `-r/--reporter`, `--iteration-data`, `--bail` and `--timeout-request` — keep their names, short forms and meaning in 1.x. New optional flags may be added.
- **Exit codes are the contract.**

  | Code | Meaning |
  | --- | --- |
  | `0` | Every run passed (including `--help`). |
  | `1` | At least one test failed. |
  | `2` | Usage or configuration error; nothing ran. |

  A 1.x release does not add another successful exit code or reuse one of these for a different outcome.

- **Secret inputs are stable.** `APIWEAVE_SECRET_<NAME>`, `--secret NAME=value` and `--secrets-file` keep their precedence and meaning, and secret values stay out of stdout, stderr and reports.
- **Input formats are stable.** A workspace repository (`format.version` 2, or the readable version 1), a `.awecollection` (`schemaVersion` `2.0`) and a Postman Collection v2.1 continue to run in 1.x.
- **Output wording is not a contract.** Human-readable log lines, the exact HTML report markup and the order of unrelated diagnostics may change. Rely on the exit code, the documented report paths, and JUnit's own schema rather than on prose.

## Deprecation

When a documented surface has to go:

1. **Announce it in the changelog and in this documentation** at least one minor release before removal, naming the replacement.
2. **Keep it working for that whole minor release.** Where practical the tool, flag or format also emits a warning — an MCP tool description, CLI help text or log line — so a user can find out before it disappears.
3. **Remove it no earlier than the next major release.** A 1.x release does not delete a documented MCP tool, CLI flag, bundle schema or repository format version.

**Security exception.** A surface that is actively exploitable may be disabled or removed immediately, without the minor-release window. The change is still recorded in the changelog (and in a security advisory where one is published), and the changelog says why the normal policy was shortened.

If a change cannot be made additively — a renamed argument, a changed exit code, a re-shaped repository file — it is a 2.0 change, not a 1.x one.

## What is not covered

These are implementation details. They may change in any release, including a patch:

- Internal IPC handler names and payloads used by the renderer. [IPC API](api.md) documents them for contributors; the MCP tool names above are the public agent surface.
- The SQLite schema, the data-directory layout under `<userData>`, and migration file names. Upgrades preserve data, and a pre-upgrade backup is taken, but the files are not an interchange format.
- Log text and format, UI copy, layout, themes, CSS and DOM structure.
- Undocumented environment variables and development flags such as `APIWEAVE_DEV_UPDATES`.
- Update-channel internals: `version.json`, `latest*.yml`, the Ed25519 signature fields and the release workflow. Clients use them through the app, not as an API.
- Single-workflow JSON exports. They are produced and consumed by APIWeave itself, not a supported interchange format.

## Related

- [Releases and the Update Channel](release-and-updates.md) — release and update mechanics
- [MCP Integration](../features/mcp-integration.md) — the agent surface in use
- [Keep Tests in a Git Repository](../guides/git-workflows.md) — workspace repository layout
- [Projects](../features/projects.md) — `.awecollection` export and import
- [Run Tests in CI](../guides/ci.md) — CLI flags, secrets and exit codes
- [Changelog](../../CHANGELOG.md) — where additions and deprecations are recorded
