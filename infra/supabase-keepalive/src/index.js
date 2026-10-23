const HEALTHCHECK_TIMEOUT_MS = 10_000;
const HEALTHCHECK_PATH = "/rest/v1/clickdeck_service_health?select=id&limit=1";

function getSupabaseOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    throw new Error("SUPABASE_URL must be an https://*.supabase.co origin");
  }
  return url.origin;
}

export async function runHealthcheck(env, fetchImpl = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY secrets are required");
  }

  const endpoint = `${getSupabaseOrigin(env.SUPABASE_URL)}${HEALTHCHECK_PATH}`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
    },
    signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Supabase healthcheck returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.id !== 1) {
    throw new Error("Supabase healthcheck record is unavailable");
  }
}

export default {
  async scheduled(_controller, env) {
    const startedAt = Date.now();
    try {
      await runHealthcheck(env);
      console.log(JSON.stringify({
        event: "clickdeck.keepalive.success",
        durationMs: Date.now() - startedAt,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "clickdeck.keepalive.failure",
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : "unknown-error",
      }));
      throw error;
    }
  },
};
