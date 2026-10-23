export type CollaborationConfig = {
  projectUrl: string;
  publishableKey: string;
};

function normalizeProjectUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function isCollaborationConfigValid(config: CollaborationConfig): boolean {
  try {
    const url = new URL(config.projectUrl);
    const key = config.publishableKey.trim();
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
    // Legacy anon JWTs are public client credentials too. This only checks the
    // credential class, not authenticity; server authentication remains mandatory.
    if (!publicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      publicKey = JSON.parse(atob(payload)).role === 'anon';
    }
    return url.protocol === "https:"
      && url.hostname.endsWith(".supabase.co")
      && !url.username && !url.password && !url.port
      && url.pathname === '/' && !url.search && !url.hash
      && publicKey;
  } catch {
    return false;
  }
}

export function getCollaborationConfig(): CollaborationConfig | null {
  const config = {
    projectUrl: normalizeProjectUrl(import.meta.env.VITE_CLICKDECK_SUPABASE_URL),
    publishableKey: (import.meta.env.VITE_CLICKDECK_SUPABASE_PUBLISHABLE_KEY ?? "").trim()
  };
  return isCollaborationConfigValid(config) ? config : null;
}
