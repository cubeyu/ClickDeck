chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "CLICKDECK_TOGGLE" });
  } catch (error) {
    console.warn("[ClickDeck] Unable to toggle content script", error);
  }
});
