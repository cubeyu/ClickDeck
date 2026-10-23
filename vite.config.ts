import { defineConfig, loadEnv } from "vite";
import { isCollaborationConfigValid } from "./src/shared/collaboration-config";
import { collaborationProtocolOptions } from './src/shared/collaboration-protocol';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { officialExtensionKey } from './src/shared/official-extension-key';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_CLICKDECK_');
  const projectUrl = (env.VITE_CLICKDECK_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const publishableKey = (env.VITE_CLICKDECK_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const protocol = collaborationProtocolOptions(env.VITE_CLICKDECK_COLLABORATION_PROTOCOL);
  const extensionKey = officialExtensionKey(env.VITE_CLICKDECK_OFFICIAL_ID);
  const diagnostics = env.VITE_CLICKDECK_SOURCE_DIAGNOSTICS === '1';
  if (protocol.invitedGuestAdmission && !isCollaborationConfigValid({projectUrl,publishableKey})) {
    throw new Error('The invited-v1 protocol requires a configured compatible collaboration backend.');
  }
  if ((projectUrl || publishableKey) && !isCollaborationConfigValid({ projectUrl, publishableKey })) {
    throw new Error('Unsafe or incomplete collaboration client configuration. Use an HTTPS Supabase project URL and a publishable/legacy anon key only; never secret or service-role keys. Values are intentionally not logged.');
  }
  return {
  plugins: diagnostics || extensionKey ? [{
    name: 'clickdeck-build-manifest',
    writeBundle(output) {
      const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
      if (extensionKey) manifest.key = extensionKey;
      if (diagnostics) {
        manifest.name = 'ClickDeck (Local diagnostics)';
        manifest.version_name = `${manifest.version}-local-diagnostics`;
      }
      writeFileSync(path.resolve(output.dir ?? 'dist', 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
  }] : [],
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: {
        background: "src/background/service-worker.ts",
        "secure-collaboration": "src/secure-collaboration.ts",
        content: "src/content/main.ts"
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
  };
});
