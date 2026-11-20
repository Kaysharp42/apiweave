import type { MutableRefObject, Ref } from "react";
import type { NodeEditorHandle } from "./NodeEditorHandle";
import type { NodeModalProps } from "./NodeModalProps";

/** The editor for one node, inside the node editor's dialog. */
export interface NodeEditorProps extends Omit<NodeModalProps, "open"> {
  readonly ref: Ref<NodeEditorHandle>;
  /** The name field: where the dialog puts focus when it opens. */
  readonly nameRef: MutableRefObject<HTMLElement | null>;
}
