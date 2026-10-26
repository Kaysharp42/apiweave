import { describe, expect, it } from "vitest"
import type { GitMergePick } from "../../types/GitMergePick"
import type { JsonValue } from "../../types/JsonValue"
import { GitMergeInputError, mergeTree } from "../tree"
import {
  ATTRIBUTES_FILE,
  ATTRIBUTES_TEXT,
  FORMAT_FILE,
  WORKSPACE_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  fileText,
  recordPath,
  stableJson,
  workflowDocument,
} from "../../workspace-repo/format"
import {
  WORKSPACE_ID,
  edited,
  environment,
  nodeIn,
  recordIn,
  sampleTree,
  treeOf,
  workflow,
  workflowIn,
  type Tree,
} from "./trees"

const base = sampleTree()
const ourFiles = treeOf(base)
const ourTree = (edit: (draft: Tree) => void) => treeOf(edited(base, edit))
const merge = (ours: Map<string, string>, theirs: Map<string, string>, picks: GitMergePick[] = []) => mergeTree(ourFiles, ours, theirs, picks)

describe("files added, deleted and changed", () => {
  it("takes a record one copy added", () => {
    const added = ourTree((draft) => draft.workflows.push(workflow("wf_new", { name: "Invoice" })))
    const result = merge(added, ourFiles)

    expect(result.conflicts).toEqual([])
    expect(recordIn(result.files, "workflows", "wf_new")).toEqual(workflow("wf_new", { name: "Invoice" }))
  })

  it("takes a record the remote copy added", () => {
    const added = ourTree((draft) => draft.environments.push(environment("env_stage", { name: "Stage" })))
    const result = merge(ourFiles, added)

    expect(result.conflicts).toEqual([])
    expect(result.files.has(recordPath("environments", "env_stage", "Stage"))).toBe(true)
  })

  it("writes a record both copies added alike once", () => {
    const added = (draft: Tree) => draft.workflows.push(workflow("wf_new", { name: "Invoice", nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }] }))

    const result = merge(ourTree(added), ourTree(added))

    expect(result.conflicts).toEqual([])
    expect(result.files.has(recordPath("workflows", "wf_new", "Invoice"))).toBe(true)
  })

  it("deletes a record one copy deleted and the other left alone", () => {
    const deleted = ourTree((draft) => {
      draft.workflows = draft.workflows.filter((item) => item.workflowId !== "wf_orders")
    })

    expect(merge(deleted, ourFiles).files.has(recordPath("workflows", "wf_orders", "Orders"))).toBe(false)
  })

  it("deletes it when both copies deleted it", () => {
    const deleted = ourTree((draft) => {
      draft.environments = draft.environments.filter((item) => item.environmentId !== "env_prod")
    })

    expect(merge(deleted, deleted).files.has(recordPath("environments", "env_prod", "Prod"))).toBe(false)
  })

  it("is a whole-record conflict when one copy deleted it and the other changed it", () => {
    const deleted = ourTree((draft) => {
      draft.workflows = draft.workflows.filter((item) => item.workflowId !== "wf_orders")
    })
    const renamed = ourTree((draft) => {
      workflowIn(draft, "wf_orders").name = "Purchases"
    })

    const open = merge(deleted, renamed)
    expect(open.conflicts).toEqual([{ kind: "workflow", recordId: "wf_orders", name: "Purchases", path: "", base: expect.anything(), theirs: expect.anything() }])
    expect(open.files.has(recordPath("workflows", "wf_orders", "Purchases"))).toBe(true)

    const settled = merge(deleted, renamed, [{ recordId: "wf_orders", path: "", side: "ours" }])
    expect(settled.conflicts).toEqual([])
    expect(settled.files.has(recordPath("workflows", "wf_orders", "Purchases"))).toBe(false)
  })

  it("is one conflict when both copies added a record under the same id, though real ids are unique", () => {
    const ours = ourTree((draft) => draft.workflows.push(workflow("wf_new", { name: "Invoice", tags: ["mine"] })))
    const theirs = ourTree((draft) => draft.workflows.push(workflow("wf_new", { name: "Invoice", tags: ["theirs"] })))

    const result = merge(ours, theirs)

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ kind: "workflow", recordId: "wf_new", path: "" })
    expect(result.files.has(recordPath("workflows", "wf_new", "Invoice"))).toBe(true)
  })

  it("renames the file of a record renamed on one side, without touching the record's id", () => {
    const renamed = ourTree((draft) => {
      workflowIn(draft, "wf_free").name = "Notes"
    })

    const result = merge(renamed, ourFiles)

    expect(result.files.has(recordPath("workflows", "wf_free", "Notes"))).toBe(true)
    expect(result.files.has(recordPath("workflows", "wf_free", "Scratch"))).toBe(false)
  })

  it("writes format.json and .gitattributes as the format does, whatever a copy wrote there", () => {
    const ours = new Map(ourFiles)
    ours.set(FORMAT_FILE, JSON.stringify({ version: WORKSPACE_FORMAT_VERSION, format: WORKSPACE_FORMAT }))
    ours.set(ATTRIBUTES_FILE, "*.json -text\n")

    const result = merge(ours, ourFiles)

    expect(result.conflicts).toEqual([])
    expect(result.files.get(FORMAT_FILE)).toBe(fileText({ format: WORKSPACE_FORMAT, version: WORKSPACE_FORMAT_VERSION }))
    expect(result.files.get(ATTRIBUTES_FILE)).toBe(ATTRIBUTES_TEXT)
  })

  it("merges workspace.json as a record: one copy's name, the other's description", () => {
    const ours = ourTree((draft) => {
      draft.workspace.name = "Acme QA 2"
    })
    const theirs = ourTree((draft) => {
      draft.workspace.description = "API tests"
    })

    const result = merge(ours, theirs)

    expect(result.conflicts).toEqual([])
    expect(JSON.parse(result.files.get("workspace.json")!)).toEqual({ workspaceId: WORKSPACE_ID, name: "Acme QA 2", description: "API tests" })
  })

  it("merges a file the format does not own whole: one copy's change is taken", () => {
    const ours = new Map(ourFiles)
    ours.set("README.md", "# Acme API tests\n\nRun `npm test`.\n")

    expect(merge(ours, ourFiles).files.get("README.md")).toBe("# Acme API tests\n\nRun `npm test`.\n")
    expect(merge(ours, ourFiles).conflicts).toEqual([])
  })

  it("deletes a file the format does not own when one copy deleted it", () => {
    const ours = new Map(ourFiles)
    ours.delete("README.md")

    const result = merge(ours, ourFiles)

    expect(result.files.has("README.md")).toBe(false)
    expect(result.conflicts).toEqual([])
  })

  it("is a file conflict when both copies changed a file the format does not own differently", () => {
    const ours = new Map(ourFiles)
    ours.set("README.md", "# Mine\n")
    const theirs = new Map(ourFiles)
    theirs.set("README.md", "# Remote\n")

    const open = merge(ours, theirs)
    expect(open.conflicts).toEqual([{ kind: "file", recordId: "README.md", name: "README.md", path: "", base: "# Acme API tests\n", ours: "# Mine\n", theirs: "# Remote\n" }])
    expect(open.files.get("README.md")).toBe("# Remote\n")

    expect(merge(ours, theirs, [{ recordId: "README.md", path: "", side: "ours" }]).files.get("README.md")).toBe("# Mine\n")
  })

  it("settles a file conflict with text of the user's own", () => {
    const ours = new Map(ourFiles)
    ours.set("README.md", "# Mine\n")
    const theirs = new Map(ourFiles)
    theirs.set("README.md", "# Remote\n")

    const result = merge(ours, theirs, [{ recordId: "README.md", path: "", value: "# Together\n" }])

    expect(result.conflicts).toEqual([])
    expect(result.files.get("README.md")).toBe("# Together\n")
  })

  it("merges a file only one copy added, and keeps a file only the ancestor had", () => {
    const ours = new Map(ourFiles)
    ours.set("docs/NOTES.md", "notes\n")

    const result = merge(ours, ourFiles)

    expect(result.files.get("docs/NOTES.md")).toBe("notes\n")
    expect(result.files.has("README.md")).toBe(true)
  })
})

describe("a tree the merge cannot read", () => {
  const broken = (path: string, text: string) => {
    const files = new Map(ourFiles)
    files.set(path, text)
    return files
  }

  it.each([
    ["your copy", "ours"],
    ["the remote copy", "theirs"],
  ] as const)("refuses %s's unreadable file instead of picking a side", (_, side) => {
    const path = "workflows/orders--wf_orders.json"
    const files = broken(path, "{ not json")
    const call = side === "ours" ? () => merge(files, ourFiles) : () => merge(ourFiles, files)

    expect(call).toThrow(GitMergeInputError)
    expect(call).toThrow(new RegExp(`${side === "ours" ? "your" : "remote"} copy's ${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not valid JSON`))
  })

  it("refuses a record file that does not hold its kind, or is named after another id", () => {
    expect(() => merge(broken("workflows/orders--wf_orders.json", JSON.stringify({ workflowId: "wf_orders" })), ourFiles)).toThrow(/does not hold a valid workflow/)
    expect(() => merge(ourFiles, broken("workflows/orders--wf_orders.json", fileText(workflowDocument(workflow("wf_login"), { projectId: null }))))).toThrow(/is not named <name>--wf_login.json/)
  })

  it("refuses secret storage in a copy, as the importer would, naming the file and where in it", () => {
    const theirs = ourTree((draft) => {
      draft.environments[0]!.variables["token"] = { ciphertext: "c2VjcmV0", kid: "key-1" }
    })
    const path = recordPath("environments", "env_dev", "Dev").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    let result: ReturnType<typeof merge> | undefined

    expect(() => {
      result = merge(ourFiles, theirs)
    }).toThrow(GitMergeInputError)
    expect(() => merge(ourFiles, theirs)).toThrow(new RegExp(`remote copy's ${path} holds secret storage.*'ciphertext' at 'variables\\.token'`))
    expect(result).toBeUndefined()
  })

  it.each([".git/config", ".GIT/config", ".git./info/attributes", "git~1/config", "docs/.g\u200Cit/hooks/pre-commit"])(
    "refuses a remote copy writing into git's own folder as %j, instead of merging it as a file",
    (path) => {
      const theirs = broken(path, "[filter \"x\"]\n\tclean = calc.exe\n")
      let result: ReturnType<typeof merge> | undefined

      expect(() => {
        result = merge(ourFiles, theirs)
      }).toThrow(GitMergeInputError)
      expect(() => merge(ourFiles, theirs)).toThrow(`the remote copy's ${path} is not a path a repository may hold`)
      expect(result).toBeUndefined()
    },
  )

  it("refuses the remote's history of another workspace", () => {
    const theirs = ourTree((draft) => {
      draft.workspace.workspaceId = "ws_02"
    })

    expect(() => merge(ourFiles, theirs)).toThrow(/another workspace's history/)
  })

  it("refuses a copy with no format.json or workspace.json", () => {
    const noFormat = new Map(ourFiles)
    noFormat.delete(FORMAT_FILE)
    expect(() => merge(noFormat, ourFiles)).toThrow(/format.json is missing/)

    const noWorkspace = new Map(ourFiles)
    noWorkspace.delete("workspace.json")
    expect(() => merge(ourFiles, noWorkspace)).toThrow(/workspace.json is missing/)
  })

  it("refuses a format the app does not know: a newer version is never merged over", () => {
    const newer = broken(FORMAT_FILE, fileText({ format: WORKSPACE_FORMAT, version: 2 }))

    expect(() => merge(newer, ourFiles)).toThrow(/newer APIWeave/)
  })

  it("treats an unreadable ancestor as no ancestor, not as an error", () => {
    const ancestor = new Map(ourFiles)
    ancestor.set("workflows/login--wf_login.json", "{ not json")
    ancestor.delete(FORMAT_FILE)

    const result = mergeTree(ancestor, ourFiles, ourFiles)

    expect(result.conflicts).toEqual([])
    expect(result.files).toEqual(treeOf(base))
  })
})

describe("what the merge leaves pointing at nothing", () => {
  it("a workflow the other copy put in a project yours deleted leaves the project, and the merge notes it", () => {
    const ours = ourTree((draft) => {
      workflowIn(draft, "wf_free").projectId = "prj_shop"
    })
    const theirs = ourTree((draft) => {
      draft.projects = []
    })

    const result = merge(ours, theirs)

    expect(result.conflicts).toEqual([])
    expect(recordIn(result.files, "workflows", "wf_free")?.["projectId"]).toBeNull()
    expect(result.notes).toEqual([{ type: "leftProject", recordId: "wf_free", name: "Scratch", projectId: "prj_shop" }])
  })

  it("a workflow you put in an environment the other copy deleted selects none, and the merge notes it", () => {
    const ours = ourTree((draft) => {
      workflowIn(draft, "wf_free").selectedEnvironmentId = "env_dev"
    })
    const theirs = ourTree((draft) => {
      draft.environments = draft.environments.filter((item) => item.environmentId !== "env_dev")
    })

    const result = merge(ours, theirs)

    expect(result.conflicts).toEqual([])
    expect(recordIn(result.files, "workflows", "wf_free")?.["selectedEnvironmentId"]).toBeNull()
    expect(result.notes).toEqual([{ type: "clearedEnvironment", recordId: "wf_free", name: "Scratch", environmentId: "env_dev" }])
  })

  it("leaves a reference that already names nothing in one copy as that copy has it", () => {
    const ours = ourTree((draft) => {
      workflowIn(draft, "wf_free").selectedEnvironmentId = "env_user_only"
    })

    const result = merge(ours, ourFiles)

    expect(recordIn(result.files, "workflows", "wf_free")?.["selectedEnvironmentId"]).toBe("env_user_only")
    expect(result.notes).toEqual([])
  })
})

describe("two copies that share no ancestor", () => {
  const mergeTwo = (ours: Map<string, string>, theirs: Map<string, string>, picks: GitMergePick[] = []) => mergeTree(null, ours, theirs, picks)

  it("keeps every record either copy holds, and writes the format's own files", () => {
    const ours = ourTree((draft) => {
      draft.workspace.name = "Acme QA 2"
      draft.workflows.push(workflow("wf_new", { name: "Invoice" }))
    })
    const theirs = ourTree((draft) => {
      draft.environments.push(environment("env_stage", { name: "Stage" }))
    })

    const result = mergeTwo(ours, theirs)

    expect(result.conflicts).toEqual([
      { kind: "workspace", recordId: WORKSPACE_ID, name: "Acme QA 2", path: "name", ours: "Acme QA 2", theirs: "Acme QA" },
    ])
    expect(recordIn(result.files, "workflows", "wf_new")).toBeDefined()
    expect(recordIn(result.files, "environments", "env_stage")).toBeDefined()
    // Nothing either copy holds is deleted, and the workspace's name stands as the remote's until a pick settles it.
    expect(recordIn(result.files, "workflows", "wf_login")?.["name"]).toBe("Login")
    expect(JSON.parse(result.files.get("workspace.json")!) as { readonly name: string }).toMatchObject({ name: "Acme QA" })
    expect(result.files.get(FORMAT_FILE)).toBe(fileText({ format: WORKSPACE_FORMAT, version: WORKSPACE_FORMAT_VERSION }))
    expect(result.files.get(ATTRIBUTES_FILE)).toBe(ATTRIBUTES_TEXT)
  })

  it("merges two copies alike silently, as the format would write them", () => {
    expect(mergeTwo(ourFiles, ourFiles)).toEqual({ files: treeOf(base), conflicts: [], notes: [] })
  })

  it("keeps a file the format does not own that only one copy holds, or that one copy deleted", () => {
    const ours = new Map(ourFiles)
    ours.set("docs/NOTES.md", "notes\n")

    expect(mergeTwo(ours, ourFiles).files.get("docs/NOTES.md")).toBe("notes\n")

    const theirs = new Map(ourFiles)
    theirs.delete("README.md")
    expect(mergeTwo(ourFiles, theirs).files.get("README.md")).toBe("# Acme API tests\n")
  })

  it("is a file conflict when both copies changed a file the format does not own differently", () => {
    const ours = new Map(ourFiles)
    ours.set("README.md", "# Mine\n")
    const theirs = new Map(ourFiles)
    theirs.set("README.md", "# Remote\n")

    const open = mergeTwo(ours, theirs)
    expect(open.conflicts).toEqual([{ kind: "file", recordId: "README.md", name: "README.md", path: "", ours: "# Mine\n", theirs: "# Remote\n" }])
    expect(open.files.get("README.md")).toBe("# Remote\n")

    expect(mergeTwo(ours, theirs, [{ recordId: "README.md", path: "", side: "ours" }]).files.get("README.md")).toBe("# Mine\n")
  })

  it("settles two copies' node positions by the format's rule, and notes what it settled", () => {
    const ours = ourTree((draft) => {
      nodeIn(workflowIn(draft, "wf_login"), "n1").position = { x: 210, y: 0 }
    })
    const theirs = ourTree((draft) => {
      nodeIn(workflowIn(draft, "wf_login"), "n1").position = { x: 220, y: 5 }
    })

    const result = mergeTwo(ours, theirs)

    expect(result.conflicts).toEqual([])
    expect(result.notes).toEqual([{ type: "positions", recordId: "wf_login", name: "Login", nodeIds: ["n1"] }])
    expect(recordIn(result.files, "workflows", "wf_login")?.["name"]).toBe("Login")
  })

  it("settles a record's conflicts with picks, the whole record included", () => {
    const ours = ourTree((draft) => {
      workflowIn(draft, "wf_free").name = "Mine"
      workflowIn(draft, "wf_free").description = "mine"
    })
    const theirs = ourTree((draft) => {
      workflowIn(draft, "wf_free").name = "Theirs"
      workflowIn(draft, "wf_free").description = "theirs"
    })

    expect(mergeTwo(ours, theirs).conflicts.map((conflict) => conflict.path)).toEqual(["description", "name"])

    const settled = mergeTwo(ours, theirs, [{ recordId: "wf_free", path: "name", side: "ours" }])
    expect(settled.conflicts.map((conflict) => conflict.path)).toEqual(["description"])
    expect(recordIn(settled.files, "workflows", "wf_free")?.["name"]).toBe("Mine")

    const whole = mergeTwo(ours, theirs, [{ recordId: "wf_free", path: "", side: "ours" }])
    expect(whole.conflicts).toEqual([])
    expect(recordIn(whole.files, "workflows", "wf_free")).toMatchObject({ name: "Mine", description: "mine" })
  })

  it("still refuses a remote copy of another workspace", () => {
    const theirs = ourTree((draft) => {
      draft.workspace.workspaceId = "ws_02"
    })

    expect(() => mergeTwo(ourFiles, theirs)).toThrow(/another workspace's history/)
  })
})

describe("conflicts and notes across the tree", () => {
  it("are in a stable order: records by kind and id, then path; files last", () => {
    const ours = ourTree((draft) => {
      draft.workspace.name = "Mine"
      workflowIn(draft, "wf_login").name = "Mine"
      workflowIn(draft, "wf_orders").name = "Mine"
    })
    const theirs = ourTree((draft) => {
      draft.workspace.name = "Theirs"
      workflowIn(draft, "wf_login").name = "Theirs"
      workflowIn(draft, "wf_orders").name = "Theirs"
    })
    const withFile = new Map(ours)
    withFile.set("README.md", "mine\n")
    const theirsWithFile = new Map(theirs)
    theirsWithFile.set("README.md", "theirs\n")

    expect(merge(withFile, theirsWithFile).conflicts.map((conflict) => [conflict.kind, conflict.recordId, conflict.path])).toEqual([
      ["workspace", "ws_01", "name"],
      ["workflow", "wf_login", "name"],
      ["workflow", "wf_orders", "name"],
      ["file", "README.md", ""],
    ])
  })

  it("settle per field, or per record, and ignore a pick that names no conflict", () => {
    const ours = ourTree((draft) => {
      workflowIn(draft, "wf_login").name = "Mine"
      workflowIn(draft, "wf_login").description = "mine"
    })
    const theirs = ourTree((draft) => {
      workflowIn(draft, "wf_login").name = "Theirs"
      workflowIn(draft, "wf_login").description = "theirs"
    })

    const noPicks = merge(ours, theirs)
    expect(noPicks.conflicts.map((conflict) => conflict.path).sort()).toEqual(["description", "name"])

    const oneField = merge(ours, theirs, [{ recordId: "wf_login", path: "name", side: "ours" }, { recordId: "wf_login", path: "gone", side: "ours" }])
    expect(oneField.conflicts.map((conflict) => conflict.path)).toEqual(["description"])
    expect(recordIn(oneField.files, "workflows", "wf_login")?.["name"]).toBe("Mine")
    expect(recordIn(oneField.files, "workflows", "wf_login")?.["description"]).toBe("theirs")

    const wholeRecord = merge(ours, theirs, [{ recordId: "wf_login", path: "", side: "ours" }])
    expect(wholeRecord.conflicts).toEqual([])
    expect(recordIn(wholeRecord.files, "workflows", "wf_login")?.["name"]).toBe("Mine")
    expect(recordIn(wholeRecord.files, "workflows", "wf_login")?.["description"]).toBe("mine")
  })

  it("are deterministic: the same three trees always give the same bytes", () => {
    const ours = ourTree((draft) => {
      draft.workflows.push(workflow("wf_new", { name: "Invoice" }))
      workflowIn(draft, "wf_login").variables = { user: "bob" }
    })
    const theirs = ourTree((draft) => {
      workflowIn(draft, "wf_login").variables = { region: "us" }
      draft.environments = draft.environments.filter((item) => item.environmentId !== "env_prod")
    })

    const first = merge(ours, theirs)
    const second = merge(ours, theirs)

    expect([...first.files]).toEqual([...second.files])
    expect(first.conflicts).toEqual(second.conflicts)
    expect(first.notes).toEqual(second.notes)
  })
})

describe("a clean merge is what the next ordinary commit would write", () => {
  it("serializes every file byte-identically to the format's writer", () => {
    const ours = ourTree((draft) => {
      workflowIn(draft, "wf_login").variables = { user: "bob", region: "eu" }
      draft.workflows.push(workflow("wf_new", { name: "Invoice", nodes: [{ nodeId: "b2", type: "delay", position: { x: 250.4, y: 10.5 }, config: { duration: 3 } }, { nodeId: "a1", type: "start", position: { x: 0, y: 0 } }] }))
    })
    const theirs = ourTree((draft) => {
      workflowIn(draft, "wf_login").description = "Signs in"
      draft.projects[0]!.color = "#112233"
    })

    const result = merge(ours, theirs)
    const expected = edited(base, (draft) => {
      workflowIn(draft, "wf_login").variables = { user: "bob", region: "eu" }
      workflowIn(draft, "wf_login").description = "Signs in"
      draft.workflows.push(workflow("wf_new", { name: "Invoice", nodes: [{ nodeId: "b2", type: "delay", position: { x: 250.4, y: 10.5 }, config: { duration: 3 } }, { nodeId: "a1", type: "start", position: { x: 0, y: 0 } }] }))
      draft.projects[0]!.color = "#112233"
    })

    expect(result.conflicts).toEqual([])
    expect(result.files).toEqual(treeOf(expected))
    for (const [path, text] of result.files) {
      if (!path.endsWith(".json")) continue
      expect(fileText(JSON.parse(text) as Record<string, JsonValue>), path).toBe(text)
    }
  })

  it("keeps stableJson of each record fixed, so a re-serialization is no churn", () => {
    const result = merge(ourFiles, ourFiles)
    for (const [path, text] of result.files) {
      if (!path.endsWith(".json")) continue
      const parsed = JSON.parse(text) as Parameters<typeof stableJson>[0]
      expect(stableJson(JSON.parse(stableJson(parsed))), path).toBe(stableJson(parsed))
    }
  })
})
