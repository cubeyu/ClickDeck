import type { IntentPromptInput } from "../export/intent-prompt";
import type { PersistedPatch, ElementLocator } from "../state/editor-state";
import { summarizeVisualUnit } from "../content/region-context";
import type { RectLike } from "../content/visual-units";
import { compactSubmissionTasks } from "./collaboration-compaction";

export const COLLABORATION_LIMITS = {
  maxMembers: 6,
  maxTasks: 100,
  projectLifetimeMs: 48 * 60 * 60 * 1000
} as const;

export type SharedTaskKind = "style" | "content" | "attribute" | "intent" | "move" | "remove";

export type SharedElementLocator = Omit<ElementLocator, "backgroundImageHint">;

export type SharedRegionEvidence = {
  userIntent: string;
  pageMode: "slide" | "long" | "unknown";
  relativeBox?: RectLike;
  anchor: {
    kind: "slide" | "section" | "container" | "document";
    label?: string;
    locator?: SharedElementLocator;
    confidence: "high" | "medium" | "low";
  };
  contents: string[];
  nearby: Array<{ direction: "above" | "below" | "left" | "right"; summary: string }>;
  confidence: "high" | "medium" | "low";
};

export type SharedTask = {
  id: string;
  sequence: number;
  kind: SharedTaskKind;
  summary: string;
  locator?: SharedElementLocator;
  before?: string;
  after?: string;
  property?: string;
  attribute?: "src";
  source?: SharedRegionEvidence;
  target?: SharedRegionEvidence;
};

export type SharedProject = {
  fingerprintVersion?: "dom-v1" | "source-v2";
  version: 1;
  id: string;
  title: string;
  pageFingerprint: string;
  ownerMemberId: string;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
};

export type SharedMember = {
  version: 1;
  id: string;
  projectId: string;
  displayName: string;
  role: "owner" | "member";
  joinedAt: number;
};

export type SharedSubmission = {
  version: 1;
  id: string;
  projectId: string;
  memberId: string;
  memberDisplayName: string;
  pageFingerprint: string;
  tasks: SharedTask[];
  submittedAt: number;
};

export type SharedProjectSnapshot = {
  version: 1;
  project: SharedProject;
  members: SharedMember[];
  submissions: SharedSubmission[];
  invalidTaskCount?: number;
  rawTaskCount?: number;
};

export type SubmissionSerializationResult =
  | { ok: true; submission: SharedSubmission }
  | { ok: false; rejectedTaskIds: string[]; reason: "empty" | "unsafe-task" | "task-limit" };

const MAX_TEXT_LENGTH = 4000;

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
function finiteRect(rect: RectLike | undefined): RectLike | undefined {
  if (!rect) return undefined;
  const values = [rect.left, rect.top, rect.width, rect.height, rect.right, rect.bottom];
  if (!values.every(Number.isFinite)) return undefined;
  return { ...rect };
}

function sanitizeLocator(locator: ElementLocator | undefined): SharedElementLocator | undefined {
  if (!locator || !cleanText(locator.tagName, 80) || !cleanText(locator.cssPath, 1000)) return undefined;
  return {
    descriptor: cleanText(locator.descriptor, 500),
    tagName: cleanText(locator.tagName, 80),
    roleHint: cleanText(locator.roleHint, 200) || undefined,
    textSnippet: cleanText(locator.textSnippet, 500) || undefined,
    imageHint: cleanText(locator.imageHint, 1000) || undefined,
    classHint: cleanText(locator.classHint, 500) || undefined,
    idHint: cleanText(locator.idHint, 300) || undefined,
    cssPath: cleanText(locator.cssPath, 1000),
    nthOfTypePath: cleanText(locator.nthOfTypePath, 1000),
    siblingIndex: Number.isInteger(locator.siblingIndex) ? locator.siblingIndex : 0,
    parentDescriptor: cleanText(locator.parentDescriptor, 500) || undefined,
    semanticRole: cleanText(locator.semanticRole, 200) || undefined,
    semanticAncestor: cleanText(locator.semanticAncestor, 500) || undefined,
    previousSiblingDescriptor: cleanText(locator.previousSiblingDescriptor, 500) || undefined,
    nextSiblingDescriptor: cleanText(locator.nextSiblingDescriptor, 500) || undefined,
    selectorStability: locator.selectorStability,
    selectorStabilityReason: cleanText(locator.selectorStabilityReason, 500) || undefined
  };
}

function serializeRegion(input: IntentPromptInput["sourceContext"]): SharedRegionEvidence {
  return {
    userIntent: cleanText(input.region.userIntent),
    pageMode: input.region.pageMode,
    relativeBox: finiteRect(input.region.relativeBox),
    anchor: {
      kind: input.region.anchor.kind,
      label: cleanText(input.region.anchor.label, 300) || undefined,
      locator: sanitizeLocator(input.region.anchor.locator),
      confidence: input.region.anchor.confidence
    },
    contents: input.candidates.slice(0, 3).map(({ unit }) => cleanText(summarizeVisualUnit(unit), 500)),
    nearby: input.nearby.slice(0, 8).map((item) => ({
      direction: item.direction,
      summary: cleanText(item.summary, 500)
    })),
    confidence: input.confidence
  };
}

export function serializePatchTask(patch: PersistedPatch, sequence: number): SharedTask | null {
  const locator = sanitizeLocator(patch.targetLocator);
  if (!locator) return null;
  return {
    id: cleanText(patch.id, 200),
    sequence,
    kind: patch.kind,
    summary: cleanText(patch.targetDescriptor, 500),
    locator,
    before: cleanText(patch.before),
    after: cleanText(patch.after),
    property: cleanText(patch.property, 100) || undefined,
    attribute: patch.attribute
  };
}

export function serializeIntentTask(input: IntentPromptInput, sequence: number): SharedTask | null {
  const id = cleanText(input.operation.id, 200);
  if (!id || (input.operation.action === "move" && !input.targetContext)) return null;
  const source = serializeRegion(input.sourceContext);
  return {
    id,
    sequence,
    kind: input.operation.action,
    summary: source.userIntent || `${input.operation.action} selected region`,
    source,
    target: input.targetContext ? serializeRegion(input.targetContext) : undefined
  };
}

export function createSharedSubmission(input: {
  id: string;
  projectId: string;
  memberId: string;
  memberDisplayName: string;
  pageFingerprint: string;
  patches: PersistedPatch[];
  intents: IntentPromptInput[];
  submittedAt: number;
}): SubmissionSerializationResult {
  const rejectedTaskIds: string[] = [];
  let tasks: SharedTask[] = [];
  input.intents.forEach((intent, index) => {
    const task = serializeIntentTask(intent, index);
    if (task) tasks.push(task);
    else rejectedTaskIds.push(cleanText(intent.operation.id, 200) || `intent-${index + 1}`);
  });
  input.patches.forEach((patch, index) => {
    const task = serializePatchTask(patch, input.intents.length + index);
    if (task) tasks.push(task);
    else rejectedTaskIds.push(cleanText(patch.id, 200) || `patch-${index + 1}`);
  });
  if (rejectedTaskIds.length > 0) return { ok: false, rejectedTaskIds, reason: "unsafe-task" };
  tasks = compactSubmissionTasks(tasks);
  if (tasks.length === 0) return { ok: false, rejectedTaskIds: [], reason: "empty" };
  if (tasks.length > COLLABORATION_LIMITS.maxTasks) {
    return { ok: false, rejectedTaskIds: tasks.slice(COLLABORATION_LIMITS.maxTasks).map((task) => task.id), reason: "task-limit" };
  }
  const submission: SharedSubmission = {
    version: 1,
    id: cleanText(input.id, 200),
    projectId: cleanText(input.projectId, 200),
    memberId: cleanText(input.memberId, 200),
    memberDisplayName: cleanText(input.memberDisplayName, 120),
    pageFingerprint: cleanText(input.pageFingerprint, 64).toLowerCase(),
    tasks,
    submittedAt: input.submittedAt
  };
  try {
    JSON.stringify(submission);
  } catch {
    return { ok: false, rejectedTaskIds: tasks.map((task) => task.id), reason: "unsafe-task" };
  }
  return { ok: true, submission };
}
