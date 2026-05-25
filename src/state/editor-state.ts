import type { StyleProperty } from "./style-token";

export type ElementLocator = {
  descriptor: string;
  tagName: string;
  roleHint?: string;
  textSnippet?: string;
  imageHint?: string;
  classHint?: string;
  idHint?: string;
  cssPath: string;
  nthOfTypePath: string;
  siblingIndex: number;
  parentDescriptor?: string;
};

export type SelectedElementState = {
  element: HTMLElement;
  descriptor: string;
};

export type StylePatch = {
  id: string;
  kind: "style";
  targetElement: HTMLElement;
  targetDescriptor: string;
  targetLocator?: ElementLocator;
  property: StyleProperty;
  before: string;
  after: string;
  createdAt: number;
};

export type ContentPatch = {
  id: string;
  kind: "content";
  targetElement: HTMLElement;
  targetDescriptor: string;
  targetLocator?: ElementLocator;
  before: string;
  after: string;
  createdAt: number;
};

export type EditorPatch = StylePatch | ContentPatch;

export type EditorState = {
  active: boolean;
  selected: SelectedElementState | null;
  patches: EditorPatch[];
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

export function recordContentPatch(state: EditorState, patch: ContentPatch): void {
  state.patches.push(patch);
}
