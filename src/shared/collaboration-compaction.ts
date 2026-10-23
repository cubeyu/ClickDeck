import type { SharedTask } from "./collaboration-contract";

// Called for one contributor only. Never compact different people's opinions.
export function compactSubmissionTasks(tasks: SharedTask[]): SharedTask[] {
  const result: SharedTask[] = [];
  const indices = new Map<string, number>();
  for (const task of tasks) {
    const path = task.locator?.cssPath;
    const field = task.kind === "style" ? task.property : task.kind === "attribute" ? task.attribute : task.kind === "content" ? "text" : undefined;
    const key = path && field
      ? JSON.stringify([task.kind, path, task.locator?.tagName, field])
      : JSON.stringify(["id", task.id]);
    const index = indices.get(key);
    if (index === undefined) {
      indices.set(key, result.length);
      result.push({ ...task });
    } else {
      const before = result[index].before;
      result[index] = { ...task, ...(before !== undefined ? { before } : {}) };
    }
  }
  return result.map((task, sequence) => ({ ...task, sequence }));
}
