import type { SharedTask } from "./collaboration-contract";
import schema from "./collaboration-task-schema.json";

type Schema = { type: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; maxItems?: number; enum?: string[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
function matches(value: unknown, spec: Schema): boolean {
  if (spec.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (spec.required ?? []).every(k => record[k] !== undefined)
      && Object.entries(record).every(([key, item]) => item === undefined || (Object.hasOwn(spec.properties ?? {}, key) && matches(item, spec.properties![key])));
  }
  if (spec.type === "array") return Array.isArray(value) && value.length <= spec.maxItems! && value.every(item => matches(item, spec.items!));
  if (spec.type === "string") return typeof value === "string" && value.length <= spec.maxLength! && value.length >= (spec.minLength ?? 0) && (!spec.enum || spec.enum.includes(value));
  return typeof value === "number" && Number.isFinite(value) && (spec.type !== "integer" || Number.isInteger(value)) && value >= spec.minimum! && value <= spec.maximum!;
}
export function validSharedTask(value: unknown): value is SharedTask { return matches(value, schema); }
export function validSharedTasks(value: unknown): value is SharedTask[] {
  try {
    return Array.isArray(value) && value.length > 0 && value.length <= 100
      && new TextEncoder().encode(JSON.stringify(value)).length <= 262144 && value.every(validSharedTask);
  } catch { return false; }
}
