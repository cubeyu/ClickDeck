import type { SharedProjectSnapshot } from "../shared/collaboration-contract";

// A plain-text archive, not an execution prompt. Never render collaborator HTML.
export function collaborationBackup(snapshot: SharedProjectSnapshot, syncedAt: number, stale: boolean): string {
  const lines = ["ClickDeck 团队建议备份 / Team suggestion backup", snapshot.project.title,
    "这是已读取的提案，不代表已执行；包含未选中及可能冲突的建议。",
    `同步时间 / Synced: ${new Date(syncedAt).toISOString()}`,
    `截止时间 / Deadline: ${new Date(snapshot.project.expiresAt).toISOString()}`,
    stale ? "注意：刷新失败，以下是上次成功读取的快照，可能缺少后续提交。" : "仅包含本次成功读取的快照，不含未提交的本地草稿。",
    snapshot.invalidTaskCount ? `注意：${snapshot.invalidTaskCount} 条异常建议被隔离，本备份不完整。` : "",
    ""];
  let number = 0;
  for (const submission of snapshot.submissions) for (const task of submission.tasks) {
    lines.push(`${++number}. ${submission.memberDisplayName} · ${task.kind} · ${task.summary}`,
      `位置 / Target: ${task.source?.anchor.label || task.locator?.descriptor || task.locator?.cssPath || "未记录 / Unknown"}`,
      `${task.property || task.attribute || task.kind}: ${task.before ?? "原值未记录 / Before unknown"} → ${task.after ?? task.source?.userIntent ?? task.summary}`, "");
  }
  // Keep every validated task and locator verbatim for later review, not only the summary.
  lines.push("完整已读取数据 / Full downloaded data (JSON)", JSON.stringify(snapshot, null, 2));
  return lines.join("\n");
}

export function downloadCollaborationBackup(snapshot: SharedProjectSnapshot, syncedAt: number, stale: boolean): void {
  const url = URL.createObjectURL(new Blob([collaborationBackup(snapshot, syncedAt, stale)], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `clickdeck-team-backup-${Date.now()}.txt`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
