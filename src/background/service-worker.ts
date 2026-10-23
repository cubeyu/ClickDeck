import type { SourceLocationTarget } from "../shared/messages";
import { fetchAndResolveSourceLocations } from "../export/source-location";
import { createCollaborationClient } from "./collaboration-client";
import { createCollaborationSecurity, isSecureCollaborationSender } from "./collaboration-security";
import { readSourceFingerprint } from "./source-fingerprint";
import { createGoogleOAuthFlow } from './collaboration-oauth';
import { getCollaborationConfig } from '../shared/collaboration-config';
import { collaborationProtocolOptions } from '../shared/collaboration-protocol';
import { createPrivateCollaborationStorage } from './private-collaboration-storage';

const DEFAULT_ACTION_TITLE = "Toggle ClickDeck";
// Keep these constants local so Vite does not create a shared ESM chunk for the
// classic content script. Their string values are the cross-context contract.
const CLICKDECK_TOGGLE_MESSAGE = "CLICKDECK_TOGGLE";
const CLICKDECK_CAPTURE_VISIBLE_TAB = "CLICKDECK_CAPTURE_VISIBLE_TAB";
const CLICKDECK_RESOLVE_SOURCE_LOCATIONS = "CLICKDECK_RESOLVE_SOURCE_LOCATIONS";
const CLICKDECK_COLLABORATION_REQUEST = "CLICKDECK_COLLABORATION_REQUEST";
const FILE_ACCESS_HELP = "ClickDeck needs file access for local HTML. Open chrome://extensions, find ClickDeck, click Details, then enable \"Allow access to file URLs\" / \"允许访问文件网址\" and reload the file.";
const RESTRICTED_PAGE_HELP = "ClickDeck cannot run on this browser page. Open a normal website page, localhost page, or local HTML file with file access enabled.";
const loginConfig = getCollaborationConfig();
let googleFlow: ReturnType<typeof createGoogleOAuthFlow> | undefined;
const privateStorage = createPrivateCollaborationStorage();
// Do not block core listener registration; collaboration operations await migration themselves.
void privateStorage.initialize().catch(() => undefined);
const collaborationClient = createCollaborationClient({ ...collaborationProtocolOptions(import.meta.env.VITE_CLICKDECK_COLLABORATION_PROTOCOL), storage: privateStorage, recoveryStorage: chrome.storage?.session, googleLogin: loginConfig ? async link => {
  // Optional login capability must never prevent the core background handlers
  // from registering after an upgrade with missing/unapproved permissions.
  if (!chrome.identity?.getRedirectURL || !chrome.identity?.launchWebAuthFlow) {
    throw new Error('oauth-permission-required');
  }
  googleFlow ??= createGoogleOAuthFlow({
    projectUrl: loginConfig.projectUrl, publicKey: loginConfig.publishableKey,
    redirect: chrome.identity.getRedirectURL('collaboration'),
    storage: chrome.storage.session,
    launch: url => chrome.identity.launchWebAuthFlow({ url, interactive: true })
  });
  return googleFlow(link);
} : undefined });
const collaborationSecurity = createCollaborationSecurity(collaborationClient, privateStorage);

export type ActivationTargetKind = "injectable" | "file" | "restricted";

export function classifyActivationUrl(url?: string): ActivationTargetKind {
  if (!url) {
    return "restricted";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "restricted";
  }

  if (parsed.protocol === "file:") {
    return "file";
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (
      parsed.hostname === "chromewebstore.google.com" ||
      (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore"))
    ) {
      return "restricted";
    }
    return "injectable";
  }

  return "restricted";
}

function getActivationFailureMessage(kind: ActivationTargetKind): string {
  if (kind === "file") {
    return FILE_ACCESS_HELP;
  }
  return RESTRICTED_PAGE_HELP;
}

async function sendToggleMessage(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: CLICKDECK_TOGGLE_MESSAGE });
}

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function clearActionFeedback(tabId: number): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE });
}

async function showActionFailure(tabId: number, kind: ActivationTargetKind): Promise<void> {
  const title = getActivationFailureMessage(kind);
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d97706" });
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setTitle({ tabId, title });
}

export async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) {
    return;
  }

  const tabId = tab.id;
  const kind = classifyActivationUrl(tab.url);

  if (kind === "restricted") {
    await showActionFailure(tabId, kind);
    return;
  }

  try {
    await sendToggleMessage(tabId);
    await clearActionFeedback(tabId);
    return;
  } catch (firstError) {
    try {
      await injectContentScript(tabId);
      await sendToggleMessage(tabId);
      await clearActionFeedback(tabId);
    } catch (secondError) {
      console.warn("[ClickDeck] Unable to toggle content script", {
        firstError,
        secondError,
        url: tab.url
      });
      await showActionFailure(tabId, kind);
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  handleActionClick(tab).catch((error) => {
    console.warn("[ClickDeck] Unable to handle action click", error);
  });
});

export async function resolveSourceLocationRequest(
  tabUrl: string | undefined,
  targets: SourceLocationTarget[],
  fetcher: typeof fetch = fetch
) {
  if (!tabUrl) {
    return { locations: {}, unavailableReason: "missing-tab-url" };
  }
  const safeTargets = Array.isArray(targets) ? targets.slice(0, 50) : [];
  return fetchAndResolveSourceLocations(tabUrl, safeTargets, fetcher);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "CLICKDECK_SECURE_COLLABORATION" && isSecureCollaborationSender(sender)) {
    collaborationSecurity.secure(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: "network-error" }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !msg || typeof msg !== "object") return false;
  if (msg.type === CLICKDECK_COLLABORATION_REQUEST) {
    if (msg.request?.action === "verify-source") {
      readSourceFingerprint(sender.tab.url).then(result => sendResponse(result.ok ? { ok: true, data: { fingerprint: result.fingerprint } } : result));
      return true;
    }
    if (msg.request?.action === "secure-window") {
      collaborationSecurity.open(msg.request, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: "network-error" }));
      return true;
    }
    if (!["status", "read"].includes(msg.request?.action)) { sendResponse({ ok: false, error: "confirmation-required" }); return false; }
    collaborationClient.handle(msg.request).then(sendResponse).catch(() => {
      sendResponse({ ok: false, error: "network-error" });
    });
    return true;
  }
  if (msg.type === CLICKDECK_RESOLVE_SOURCE_LOCATIONS) {
    resolveSourceLocationRequest(sender.tab?.url, msg.targets)
      .then(sendResponse)
      .catch((error) => {
        console.warn("[ClickDeck] source location lookup failed", error);
        sendResponse({ locations: {}, unavailableReason: "source-location-error" });
      });
    return true;
  }

  if (msg.type === CLICKDECK_CAPTURE_VISIBLE_TAB) {
    chrome.tabs.captureVisibleTab(
      sender.tab?.windowId || chrome.windows.WINDOW_ID_CURRENT,
      { format: "png" }
    ).then((dataUrl) => {
      sendResponse({ dataUrl });
    }).catch((error) => {
      console.warn("[ClickDeck] captureVisibleTab failed", error);
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });

    return true;
  }

  return false;
});
