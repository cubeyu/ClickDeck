import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runHealthcheck } from "../../infra/supabase-keepalive/src/index.js";

const config = readFileSync(new URL("../../infra/supabase-keepalive/wrangler.jsonc", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/202609110002_clickdeck_service_health.sql", import.meta.url), "utf8");

describe("Supabase keepalive infrastructure", () => {
  it("checks only the dedicated one-row health resource", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await runHealthcheck({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "public-client-key",
    }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/clickdeck_service_health?select=id&limit=1");
    expect(init.method).toBe("GET");
    expect(init.headers.apikey).toBe("public-client-key");
    expect(init.headers.Authorization).toBeUndefined();
    expect(String(url)).not.toMatch(/clickdeck_(projects|members|submissions)/);
  });

  it("fails closed for missing or invalid configuration", async () => {
    await expect(runHealthcheck({}, vi.fn())).rejects.toThrow("secrets are required");
    await expect(runHealthcheck({
      SUPABASE_URL: "http://example.test",
      SUPABASE_PUBLISHABLE_KEY: "public-client-key",
    }, vi.fn())).rejects.toThrow("https://*.supabase.co");
  });

  it("runs three times daily without exposing an HTTP route", () => {
    expect(config).toContain('"crons": ["17 1,9,17 * * *"]');
    expect(config).toContain('"workers_dev": false');
    expect(config).toContain('"preview_urls": false');
  });

  it("exposes only the static row to anon and cannot renew collaboration projects", () => {
    expect(migration).toContain("grant select on public.clickdeck_service_health to anon");
    expect(migration).toContain("for select\nto anon");
    expect(migration).not.toMatch(/update\s+public\.clickdeck_projects/i);
    expect(migration).not.toMatch(/clickdeck_(members|submissions)/i);
  });
});
