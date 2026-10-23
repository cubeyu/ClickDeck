import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../supabase/migrations/202609090001_clickdeck_collaboration_beta.sql", import.meta.url);
const sql = readFileSync(migrationUrl, "utf8");
const retentionMigrationUrl = new URL("../../supabase/migrations/202609110001_clickdeck_collaboration_48h.sql", import.meta.url);
const retentionSql = readFileSync(retentionMigrationUrl, "utf8");

describe("collaboration Supabase migration guardrails", () => {
  it("enables RLS and keeps table writes behind authenticated RPC functions", () => {
    expect(sql.match(/enable row level security/g)).toHaveLength(3);
    expect(sql).toContain("revoke all on public.clickdeck_projects from anon, authenticated");
    expect(sql).toContain("grant select on public.clickdeck_projects, public.clickdeck_members, public.clickdeck_submissions to authenticated");
    expect(sql).toContain("grant execute on function public.create_clickdeck_project");
    expect(sql).toContain("grant execute on function public.join_clickdeck_project");
    expect(sql).toContain("grant execute on function public.submit_clickdeck_tasks");
  });

  it("hashes invitations and enforces the server-side limits", () => {
    expect(sql).toContain("digest(raw_token, 'sha256')");
    expect(sql).toContain("digest(requested_invite_token, 'sha256')");
    expect(sql).toContain(">= 6");
    expect(sql).toContain("> 100");
    expect(retentionSql.match(/interval '48 hours'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("fingerprint-mismatch");
  });

  it("does not expose the cleanup function to the browser role", () => {
    expect(sql).toContain("revoke all on function public.purge_expired_clickdeck_projects() from public");
    expect(sql).not.toContain("grant execute on function public.purge_expired_clickdeck_projects() to authenticated");
  });

  it("schedules project and orphaned anonymous identity cleanup", () => {
    expect(retentionSql).toContain("purge-expired-clickdeck-projects");
    expect(retentionSql).toContain("purge-orphaned-clickdeck-anonymous-users");
    expect(retentionSql).toContain("delete from auth.users");
    expect(retentionSql).toContain("revoke all on function public.purge_orphaned_clickdeck_anonymous_users() from public");
  });
});
