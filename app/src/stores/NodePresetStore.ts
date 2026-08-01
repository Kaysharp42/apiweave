import { create } from "zustand";
import { apiweave } from "../utils/apiweaveClient";
import type { NodePreset } from "../types/NodePreset";
import type { NodePresetNodeType } from "../types/NodePresetNodeType";

/**
 * Shared state for the workspace's saved node presets.
 *
 * A store rather than a per-component hook because two independent surfaces
 * read the same list: the canvas ("Save as preset" on a node's action menu)
 * writes it, and the Add Nodes palette renders it. Two hook instances would
 * hold two lists, and a save would not show up in the palette until remount.
 */
interface NodePresetState {
  presets: NodePreset[];
  isLoading: boolean;
  /** The workspace the current `presets` belong to — guards a stale render after a workspace switch. */
  loadedWorkspaceId: string | null;
  loadError: string | null;

  fetchPresets: (workspaceId: string) => Promise<void>;
  savePreset: (input: {
    workspaceId: string;
    name: string;
    nodeType: NodePresetNodeType;
    config: Record<string, unknown>;
  }) => Promise<NodePreset>;
  renamePreset: (
    workspaceId: string,
    presetId: string,
    name: string,
  ) => Promise<NodePreset>;
  deletePreset: (workspaceId: string, presetId: string) => Promise<void>;
}

function byName(a: NodePreset, b: NodePreset): number {
  return a.name.localeCompare(b.name);
}

const useNodePresetStore = create<NodePresetState>()((set, get) => ({
  presets: [],
  isLoading: false,
  loadedWorkspaceId: null,
  loadError: null,

  fetchPresets: async (workspaceId: string) => {
    if (!workspaceId) {
      set({ presets: [], loadedWorkspaceId: null, isLoading: false });
      return;
    }
    set({ isLoading: true });
    try {
      const result = await apiweave.nodePresets.list(workspaceId);
      set({
        presets: [...result.items].sort(byName),
        loadedWorkspaceId: workspaceId,
        loadError: null,
      });
    } catch (err) {
      set({
        presets: [],
        loadedWorkspaceId: workspaceId,
        loadError: err instanceof Error ? err.message : "Failed to load presets",
      });
    } finally {
      set({ isLoading: false });
    }
  },

  savePreset: async (input) => {
    const created = await apiweave.nodePresets.create(input);
    // Only merge into the visible list when it belongs to the loaded workspace;
    // otherwise the next fetch owns it.
    if (get().loadedWorkspaceId === input.workspaceId) {
      set((s) => ({ presets: [...s.presets, created].sort(byName) }));
    }
    return created;
  },

  renamePreset: async (workspaceId: string, presetId: string, name: string) => {
    const updated = await apiweave.nodePresets.update(workspaceId, presetId, {
      name,
    });
    // Re-sorted because the list is name-ordered, so a rename can move the row.
    set((s) => ({
      presets: s.presets
        .map((p) => (p.presetId === presetId ? updated : p))
        .sort(byName),
    }));
    return updated;
  },

  deletePreset: async (workspaceId: string, presetId: string) => {
    await apiweave.nodePresets.delete(workspaceId, presetId);
    set((s) => ({ presets: s.presets.filter((p) => p.presetId !== presetId) }));
  },
}));

export default useNodePresetStore;
