import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasNode } from "../types/CanvasNode";
import { captureCanvasHistory, recordCanvasHistory } from "./canvasHistory";

function graph(count: number): CanvasNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    type: "http-request",
    position: { x: i * 100, y: 0 },
    data: { label: `Step ${i}`, config: { url: `https://x/${i}` } },
  }));
}

const edges: CanvasEdge[] = [
  { id: "e0", source: "n0", target: "n1", type: "custom" },
];

describe("canvasHistory", () => {
  // The regression that will actually happen: a run writes status into every
  // node, and if that reaches the ring the user's last edit is 40 undos back.
  it("records nothing when a run writes status into every node", () => {
    const nodes = graph(40);
    const before = captureCanvasHistory(nodes, edges, {});
    const state = recordCanvasHistory([], -1, before);

    const afterRun = nodes.map((node) => ({
      ...node,
      selected: true,
      measured: { width: 240, height: 90 },
      data: {
        ...node.data,
        executionStatus: "success",
        executionResult: { status: 200 },
        executionTimestamp: 1,
      },
    }));

    const next = recordCanvasHistory(
      state.entries,
      state.index,
      captureCanvasHistory(afterRun, edges, {}),
    );

    expect(next.entries).toHaveLength(1);
    expect(next.entries).toBe(state.entries);
    expect(next.index).toBe(0);
  });

  it("records a real edit and restores the persisted shape", () => {
    const nodes = graph(2);
    const first = recordCanvasHistory(
      [],
      -1,
      captureCanvasHistory(nodes, edges, {}),
    );

    const moved = [nodes[0]!, { ...nodes[1]!, position: { x: 999, y: 7 } }];
    const second = recordCanvasHistory(
      first.entries,
      first.index,
      captureCanvasHistory(moved, edges, {}),
    );

    expect(second.index).toBe(1);
    expect(second.entries[1]!.nodes[1]!.position).toEqual({ x: 999, y: 7 });
    expect(second.entries[0]!.nodes[1]!.position).toEqual({ x: 100, y: 0 });
  });

  it("notices a variable change with an untouched graph", () => {
    const nodes = graph(1);
    const first = recordCanvasHistory(
      [],
      -1,
      captureCanvasHistory(nodes, edges, { token: "a" }),
    );
    const second = recordCanvasHistory(
      first.entries,
      first.index,
      captureCanvasHistory(nodes, edges, { token: "b" }),
    );

    expect(second.entries).toHaveLength(2);
  });

  it("drops the redo tail on the next edit and bounds the ring", () => {
    let state = recordCanvasHistory(
      [],
      -1,
      captureCanvasHistory(graph(1), edges, {}),
    );
    for (let i = 1; i < 5; i++) {
      state = recordCanvasHistory(
        state.entries,
        state.index,
        captureCanvasHistory(graph(1 + i), edges, {}),
        3,
      );
    }
    // Depth 3 keeps the three most recent.
    expect(state.entries).toHaveLength(3);
    expect(state.index).toBe(2);

    // Undo twice, then edit: the two futures are gone.
    const rewound = recordCanvasHistory(
      state.entries,
      0,
      captureCanvasHistory(graph(9), edges, {}),
      3,
    );
    expect(rewound.entries).toHaveLength(2);
    expect(rewound.index).toBe(1);
  });
});
