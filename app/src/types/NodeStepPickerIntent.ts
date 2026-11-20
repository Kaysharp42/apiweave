/** What a key press means while a node step picker is open. */
export type NodeStepPickerIntent =
  | { readonly kind: "close" }
  | { readonly kind: "move"; readonly by: 1 | -1 }
  | { readonly kind: "take" }
  | { readonly kind: "pick"; readonly index: number };
