// --- Tab switching ---
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// --- Element refs ---
const statTracked = document.getElementById("stat-tracked");
const statFiltered = document.getElementById("stat-filtered");
const statChannels = document.getElementById("stat-channels");
const videoListEl = document.getElementById("video-list");

// Settings elements
const sEnabled = document.getElementById("s-enabled");
const sThreshold = document.getElementById("s-threshold");
const sThresholdVal = document.getElementById("s-threshold-val");
const sSidebarPos = document.getElementById("s-sidebar-position");
const sSidebarWidth = document.getElementById("s-sidebar-width");
const sAutoCollapse = document.getElementById("s-auto-collapse");
const sTheme = document.getElementById("s-theme");
const sRetention = document.getElementById("s-retention");
const sProtectUpcoming = document.getElementById("s-protect-upcoming");
const sProtectLive = document.getElementById("s-protect-live");
const sProtectPremiere = document.getElementById("s-protect-premiere");
const sProtectPlaylist = document.getElementById("s-protect-playlist");
const sProtectSubscribed = document.getElementById("s-protect-subscribed");
const resetBtn = document.getElementById("reset-btn");
const blockInput = document.getElementById("block-channel-input");
const blockBtn = document.getElementById("block-channel-btn");
const blockedListEl = document.getElementById("blocked-list");

// --- Load everything ---
async function load() {
  const { settings = {}, videoCounts = {} } = await chrome.storage.local.get([
    "settings",
    "videoCounts",
  ]);

  const threshold = settings.threshold || 3;
  const enabled = settings.enabled !== false;

  // Populate settings UI
  sEnabled.checked = enabled;
  sThreshold.value = threshold;
  sThresholdVal.textContent = threshold;
  sSidebarPos.value = settings.sidebarPosition || "right";
  sSidebarWidth.value = settings.sidebarWidth || 360;
  sAutoCollapse.checked = settings.autoCollapse || false;
  sTheme.value = settings.theme || "auto";
  sRetention.value = settings.retentionDays || 30;
  sProtectUpcoming.checked = settings.protectUpcoming !== false;
  sProtectLive.checked = settings.protectLive !== false;
  sProtectPremiere.checked = settings.protectPremiere !== false;
  sProtectPlaylist.checked = settings.protectPlaylist !== false;
  sProtectSubscribed.checked = settings.protectSubscribed !== false;

  // Dashboard stats
  const entries = Object.entries(videoCounts);
  const filtered = entries.filter(([, e]) => e.count >= threshold && !e.clicked);
  const channels = new Set(entries.map(([, e]) => e.channelName).filter(Boolean));

  statTracked.textContent = entries.length;
  statFiltered.textContent = filtered.length;
  statChannels.textContent = channels.size;

  // Top ignored videos
  const top = filtered.sort(([, a], [, b]) => b.count - a.count).slice(0, 10);

  if (top.length === 0) {
    videoListEl.innerHTML = '<div class="empty-msg">No filtered videos yet</div>';
  } else {
    videoListEl.innerHTML = top
      .map(
        ([id, e]) => `
      <div class="video-item">
        <div class="video-info">
          <div class="video-title" title="${escapeHtml(e.title)}">${escapeHtml(e.title || id)}</div>
          <div class="video-channel">${escapeHtml(e.channelName || "Unknown")}</div>
        </div>
        <span class="video-count">${e.count}x</span>
        <button class="unfilter-btn" data-id="${id}">Unfilter</button>
      </div>
    `
      )
      .join("");

    videoListEl.querySelectorAll(".unfilter-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const videoId = btn.dataset.id;
        const { videoCounts = {} } = await chrome.storage.local.get("videoCounts");
        if (videoCounts[videoId]) {
          videoCounts[videoId].clicked = true;
          await chrome.storage.local.set({ videoCounts });
          load();
        }
      });
    });
  }

  // Blocked channels list
  renderBlockedChannels(settings.blockedChannels || []);
}

function renderBlockedChannels(channels) {
  if (channels.length === 0) {
    blockedListEl.innerHTML = '<div class="blocked-empty">No blocked channels</div>';
    return;
  }

  blockedListEl.innerHTML = channels
    .map(
      (ch) => `
    <div class="blocked-item">
      <span class="blocked-name">${escapeHtml(ch)}</span>
      <button class="blocked-remove" data-channel="${escapeHtml(ch)}" title="Remove">&times;</button>
    </div>
  `
    )
    .join("");

  blockedListEl.querySelectorAll(".blocked-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const channel = btn.dataset.channel;
      const { settings = {} } = await chrome.storage.local.get("settings");
      settings.blockedChannels = (settings.blockedChannels || []).filter(
        (c) => c.toLowerCase() !== channel.toLowerCase()
      );
      await chrome.storage.local.set({ settings });
      load();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Save settings ---
async function saveSettings() {
  const { settings: existing = {} } = await chrome.storage.local.get("settings");
  const settings = {
    ...existing,
    threshold: parseInt(sThreshold.value, 10),
    enabled: sEnabled.checked,
    sidebarPosition: sSidebarPos.value,
    sidebarWidth: parseInt(sSidebarWidth.value, 10),
    autoCollapse: sAutoCollapse.checked,
    theme: sTheme.value,
    retentionDays: parseInt(sRetention.value, 10),
    protectUpcoming: sProtectUpcoming.checked,
    protectLive: sProtectLive.checked,
    protectPremiere: sProtectPremiere.checked,
    protectPlaylist: sProtectPlaylist.checked,
    protectSubscribed: sProtectSubscribed.checked,
  };
  await chrome.storage.local.set({ settings });
  load();
}

// Settings event listeners
sEnabled.addEventListener("change", saveSettings);
sThreshold.addEventListener("input", () => {
  sThresholdVal.textContent = sThreshold.value;
});
sThreshold.addEventListener("change", saveSettings);
sSidebarPos.addEventListener("change", saveSettings);
sSidebarWidth.addEventListener("change", saveSettings);
sAutoCollapse.addEventListener("change", saveSettings);
sTheme.addEventListener("change", saveSettings);
sRetention.addEventListener("change", saveSettings);
sProtectUpcoming.addEventListener("change", saveSettings);
sProtectLive.addEventListener("change", saveSettings);
sProtectPremiere.addEventListener("change", saveSettings);
sProtectPlaylist.addEventListener("change", saveSettings);
sProtectSubscribed.addEventListener("change", saveSettings);

// Reset
resetBtn.addEventListener("click", async () => {
  if (confirm("Reset all video counts? This cannot be undone.")) {
    await chrome.storage.local.set({ videoCounts: {} });
    load();
  }
});

// Block channel
blockBtn.addEventListener("click", async () => {
  const name = blockInput.value.trim();
  if (!name) return;

  const { settings = {} } = await chrome.storage.local.get("settings");
  const list = settings.blockedChannels || [];
  if (!list.some((c) => c.toLowerCase() === name.toLowerCase())) {
    list.push(name);
    settings.blockedChannels = list;
    await chrome.storage.local.set({ settings });
  }
  blockInput.value = "";
  load();
});

blockInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") blockBtn.click();
});

// Init
load();
