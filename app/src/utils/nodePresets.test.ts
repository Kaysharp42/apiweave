import { test } from "vitest";
import assert from "node:assert/strict";
import {
  PRESETABLE_NODE_TYPES,
  asPresetNodeType,
  presetDragTemplate,
} from "./nodePresets.ts";
import type { NodePreset } from "../types/NodePreset";

function preset(overrides: Partial<NodePreset> = {}): NodePreset {
  return {
    presetId: "preset-1",
    workspaceId: "ws-1",
    name: "Standard auth headers",
    nodeType: "http-request",
    config: { headers: [{ key: "Authorization", value: "Bearer x" }] },
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("asPresetNodeType accepts every presetable node type", () => {
  for (const nodeType of PRESETABLE_NODE_TYPES) {
    assert.equal(asPresetNodeType(nodeType), nodeType);
  }
});

test("asPresetNodeType rejects config-less and unknown node types", () => {
  assert.equal(asPresetNodeType("start"), null);
  assert.equal(asPresetNodeType("end"), null);
  assert.equal(asPresetNodeType("teleport"), null);
  assert.equal(asPresetNodeType(undefined), null);
});

test("presetDragTemplate produces the {type,label,config} shape useCanvasDrop reads", () => {
  assert.deepEqual(presetDragTemplate(preset()), {
    type: "http-request",
    label: "Standard auth headers",
    config: { headers: [{ key: "Authorization", value: "Bearer x" }] },
  });
});

test("presetDragTemplate copies the config so a drag can't mutate the stored preset", () => {
  const source = preset({ config: { duration: 500 }, nodeType: "delay" });
  const template = presetDragTemplate(source);
  template.config["duration"] = 9999;

  assert.deepEqual(source.config, { duration: 500 });
});
