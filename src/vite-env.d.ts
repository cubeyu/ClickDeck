interface ImportMetaEnv {
  readonly VITE_CLICKDECK_COLLABORATION_PROTOCOL?: string;
  readonly VITE_CLICKDECK_SOURCE_DIAGNOSTICS?: string;
  readonly VITE_CLICKDECK_SUPABASE_URL?: string;
  readonly VITE_CLICKDECK_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
