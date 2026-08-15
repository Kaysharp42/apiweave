# Node Presets

*A named, saved library of reusable node configurations — a standard auth header block, a house assertion set, a Call Workflow step you use everywhere. Save one from any node on the canvas and drag it into any workflow in the same workspace.*

## Prerequisites

- [Workflows and Nodes](workflows-and-nodes.md) for the node types a preset can hold.
- [Concepts](../getting-started/concepts.md) for the workspace vocabulary.
- A workspace with at least one workflow. Presets are workspace-scoped, so the app needs to know which workspace you are in before the library appears.

## Table of Contents

- [What a Preset Is](#what-a-preset-is)
- [Saving a Preset](#saving-a-preset)
- [Using a Preset](#using-a-preset)
- [Renaming and Deleting](#renaming-and-deleting)
- [What a Preset Stores](#what-a-preset-stores)
- [Presets, Imported Groups, and Copy/Paste](#presets-imported-groups-and-copypaste)
- [Secrets in a Preset](#secrets-in-a-preset)
- [Presets Stay on This Machine](#presets-stay-on-this-machine)
- [Presets Over MCP](#presets-over-mcp)
- [Troubleshooting](#troubleshooting)

## What a Preset Is

A preset is a node configuration saved under a name you choose, stored in the same local SQLite database as your workflows and scoped to one workspace. Every workflow in that workspace sees the same library.

These node types can become a preset, because they carry configuration worth naming:

| Node type | Typical preset |
| --- | --- |
| HTTP Request | A configured auth header block, a standard `POST /login` call |
| Assertion | The house rule set: `status == 200` plus a body-shape check |
| Delay | A standard pacing delay for a rate-limited API |
| Merge | A merge strategy you reuse across fan-out flows |
| Call Workflow | A shared "Authenticate" sub-workflow call with its variable mapping |

**Start** and **End** cannot be presets. They carry no config, so there is nothing about them to name and reuse.

## Saving a Preset

1. Configure a node on the canvas until it works — run it if you want to be sure.
2. Click the `⋯` button in that node's header.
3. Choose **Save as preset**.
4. Name it. The prompt starts from the node's current label, so pressing Enter accepts something reasonable.

```text
[ HTTP Request: POST /login ]  ⋯ ▸ Save as preset  ▸  "Standard auth headers"
```

The preset appears immediately in the **Saved Presets** section of the Add Nodes panel — you do not need to reopen the workflow.

## Using a Preset

1. Open the **Add Nodes** panel (the plus button at the bottom-right of the canvas).
2. Expand **Saved Presets**. The section lists every preset in the workspace, ordered by name, each labelled with its node type and — for HTTP presets — its method badge.
3. Drag the preset onto the canvas.

The drop creates a normal node carrying the preset's configuration and the preset's name as its label. From that moment the node is independent: editing it does not change the preset, and editing the preset does not change nodes already dropped. A preset is a starting point, not a live link.

## Renaming and Deleting

Both live on the preset's row in the palette, and appear on hover or keyboard focus:

| Affordance | What it does |
| --- | --- |
| Pencil | Turns the row into an input. **Enter** saves, **Escape** cancels, and clicking away cancels. |
| Trash | Deletes the preset from the workspace. Nodes already dropped from it are untouched. |

Clicking away cancels rather than saves on purpose: the palette is a popover that closes on any outside click, so saving on blur would write a rename while the panel was tearing down.

The built-in palette entries (HTTP Requests, Control Flow, Validation) have no pencil or trash — they are not presets and cannot be edited or removed.

## What a Preset Stores

A preset row holds a `presetId`, the `workspaceId` that owns it, the `name`, the `nodeType`, the node `config`, a revision counter, and created/updated timestamps. Nothing else — a preset has no position, no edges, and no run history.

The config is canonicalised on write and validated against the node type it claims. Two consequences worth knowing:

- A preset promoted from an older node whose `headers` were stored as a single string is accepted and stored in the current key/value shape, rather than rejected.
- Changing a preset's `nodeType` to one its config does not fit is rejected with a validation error, so a preset can never hold a config its node type cannot load.

## Presets, Imported Groups, and Copy/Paste

Three things in APIWeave look similar and are not:

| | Lives where | Survives a restart | Scope |
| --- | --- | --- | --- |
| **Preset** | SQLite, with your workflows | Yes | The whole workspace |
| **Swagger-imported group** | React state in the open window | No | The current session |
| **Copy/paste of a node** | Browser `sessionStorage` | No | The current session |

Use copy/paste to move a node inside a flow you are editing now. Use a preset when the configuration is a convention you want next week too.

## Secrets in a Preset

A preset stores exactly what the node had. That means:

- **`{{secrets.NAME}}` references stay references.** They resolve at run time through the [scope chain](environments-and-secrets.md#the-scope-chain), the same as in any node, so a preset shared across workflows keeps working against each workflow's selected environment.
- **A literal token typed into a header is stored literally**, in the same database file as the workflow that carried it. A preset is inside the same trust boundary as a workflow node — no better, no worse. If you would not paste a token into a node, do not paste it into a node you then save as a preset. Put it in a secret and reference it.

## Presets Stay on This Machine

Presets are local-only. Cloud sync knows about workspaces, projects, workflows, and environments; it has no record type for a preset, so a preset is never uploaded and never appears on another machine — including your own second machine signed into the same Cloud account.

Practically: a preset library is a per-machine convenience today, not a team convention that travels. To share a configuration across machines, put it in a workflow (which does sync) or export a project as an `.awecollection` bundle.

## Presets Over MCP

A local agent connected through the [MCP bridge](mcp-integration.md) can manage the library with four tools:

| Tool | What it does |
| --- | --- |
| `nodePresets_list` | List the workspace's presets |
| `nodePresets_create` | Save a new preset from a name, node type, and config |
| `nodePresets_update` | Rename a preset or replace its config |
| `nodePresets_delete` | Delete a preset |

One limitation matters. Every MCP read passes through the same blanket redaction that protects workflow reads, so `nodePresets_list` returns each preset's name, node type, and identifiers, but reports `<SECRET>` for its request body, withholds sensitive header values, and redacts a URL only when it actually carries credentials. An agent can therefore catalogue the library, create presets from configuration it wrote itself, and tidy names — but it cannot faithfully re-emit an existing preset's config into a workflow, because it never sees the literal values. Dragging a preset onto a canvas remains a desktop action.

## Troubleshooting

- **If the Saved Presets section is missing**, either the workspace has no presets yet or the app has not resolved a workspace for the canvas. Save one preset from a node's `⋯` menu; the section appears as soon as the library is non-empty.
- **If Save as preset is absent from a node's menu**, the node is a Start or End node. Those carry no config and cannot be saved.
- **If a rename appears to do nothing**, you clicked away instead of pressing Enter. Clicking outside the input cancels; press Enter to commit.
- **If a dropped preset's request fails with an unresolved `{{secrets.NAME}}`**, the preset kept the reference but the newly selected environment does not declare that key. Add the secret to the environment or workspace scope through the write flow described in [Environments and Secrets](environments-and-secrets.md).
- **If `nodePresets_update` returns a validation error**, the config does not match the node type — most often a `nodeType` change that strands the existing config. Send the matching config in the same call.
- **If a preset is missing after switching machines**, that is expected: presets do not sync. See [Presets Stay on This Machine](#presets-stay-on-this-machine).

## Related

- [Workflows and Nodes](workflows-and-nodes.md)
- [Environments and Secrets](environments-and-secrets.md)
- [MCP Integration](mcp-integration.md)
- [Projects](projects.md)
