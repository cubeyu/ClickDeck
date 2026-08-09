export const CLICKDECK_TOGGLE_MESSAGE = "CLICKDECK_TOGGLE" as const;
export const CLICKDECK_CAPTURE_VISIBLE_TAB = "CLICKDECK_CAPTURE_VISIBLE_TAB" as const;
export const CLICKDECK_RESOLVE_SOURCE_LOCATIONS = "CLICKDECK_RESOLVE_SOURCE_LOCATIONS" as const;

export type ClickDeckToggleMessage = {
  type: typeof CLICKDECK_TOGGLE_MESSAGE;
};

export type ClickDeckCaptureVisibleTabMessage = {
  type: typeof CLICKDECK_CAPTURE_VISIBLE_TAB;
};

export type SourceLocationTarget = {
  key: string;
  tagName: string;
  idHint?: string;
  classHint?: string;
  textSnippet?: string;
  imageHint?: string;
  selectorStability?: "high" | "medium" | "low";
};

export type SourceLocationEvidence = {
  key: string;
  sourceUrl: string;
  line: number;
  column: number;
  confidence: "high";
  matchMethod: "unique-id" | "unique-class" | "unique-text" | "unique-image";
};

export type ResolveSourceLocationsResponse = {
  sourceUrl?: string;
  locations: Record<string, SourceLocationEvidence>;
  unavailableReason?: string;
};

export type ClickDeckResolveSourceLocationsMessage = {
  type: typeof CLICKDECK_RESOLVE_SOURCE_LOCATIONS;
  targets: SourceLocationTarget[];
};

export type ClickDeckMessage =
  | ClickDeckToggleMessage
  | ClickDeckCaptureVisibleTabMessage
  | ClickDeckResolveSourceLocationsMessage;
