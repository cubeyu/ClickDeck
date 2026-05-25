import type { StyleProperty } from "./style-token";

export type SelectedElementState = {
  element: HTMLElement;
  descriptor: string;
};

export type StylePatch = {
  id: string;
  targetElement: HTMLElement;
  targetDescriptor: string;
  property: StyleProperty;
  before: string;
  after: string;
  createdAt: number;
};

export type EditorState = {
  active: boolean;
  selected: SelectedElementState | null;
  patches: StylePatch[];
};

export function createEditorState(): EditorState {
  return {
    active: false,
    selected: null,
    patches: []
  };
}

export function setEditorActive(state: EditorState, active: boolean): void {
  state.active = active;
}

export function setSelectedElement(state: EditorState, selected: SelectedElementState | null): void {
  state.selected = selected;
}

export function recordStylePatch(state: EditorState, patch: StylePatch): void {
  state.patches.push(patch);
}
