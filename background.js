// Prune video entries older than retention period
async function pruneOldEntries() {
  const { videoCounts = {}, settings = {} } = await chrome.storage.local.get([
    "videoCounts",
    "settings",
  ]);
  const retentionDays = settings.retentionDays || 30;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const [id, entry] of Object.entries(videoCounts)) {
    if (entry.lastSeen < cutoff) {
      delete videoCounts[id];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ videoCounts });
  }
}

chrome.runtime.onInstalled.addListener(pruneOldEntries);
chrome.runtime.onStartup.addListener(pruneOldEntries);

// Update badge with filtered count from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "updateBadge" && sender.tab) {
    const count = msg.filteredCount;
    chrome.action.setBadgeText({
      text: count > 0 ? String(count) : "",
      tabId: sender.tab.id,
    });
    chrome.action.setBadgeBackgroundColor({
      color: "#c62828",
      tabId: sender.tab.id,
    });
  }
});
