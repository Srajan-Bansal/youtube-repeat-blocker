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
const sAccentColor = document.getElementById("s-accent-color");
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

// Keyword blocking elements
const blockKeywordInput = document.getElementById("block-keyword-input");
const blockKeywordBtn = document.getElementById("block-keyword-btn");
const blockedKeywordsListEl = document.getElementById("blocked-keywords-list");

// Category blocking elements
const sCatShorts = document.getElementById("s-cat-shorts");
const sCatMusic = document.getElementById("s-cat-music");
const sCatGaming = document.getElementById("s-cat-gaming");
const sCatNews = document.getElementById("s-cat-news");
const sCatSports = document.getElementById("s-cat-sports");

// Analytics elements
const analyticsTotal = document.getElementById("analytics-total");
const analyticsToday = document.getElementById("analytics-today");
const analyticsAvg = document.getElementById("analytics-avg");
const analyticsChannels = document.getElementById("analytics-channels");
const analyticsChart = document.getElementById("analytics-chart");

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
  sAccentColor.value = settings.accentColor || "#c62828";
  sRetention.value = settings.retentionDays || 30;

  // Apply accent color to popup
  document.documentElement.style.setProperty("--ytf-accent", settings.accentColor || "#c62828");
  sProtectUpcoming.checked = settings.protectUpcoming !== false;
  sProtectLive.checked = settings.protectLive !== false;
  sProtectPremiere.checked = settings.protectPremiere !== false;
  sProtectPlaylist.checked = settings.protectPlaylist !== false;
  sProtectSubscribed.checked = settings.protectSubscribed !== false;

  // Category blocking
  const cats = settings.blockedCategories || {};
  sCatShorts.checked = cats.shorts || false;
  sCatMusic.checked = cats.music || false;
  sCatGaming.checked = cats.gaming || false;
  sCatNews.checked = cats.news || false;
  sCatSports.checked = cats.sports || false;

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

  // Blocked keywords list
  renderBlockedKeywords(settings.blockedKeywords || []);

  // Analytics
  renderAnalytics(videoCounts, threshold);
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

// Feature 1: Blocked keywords rendering
function renderBlockedKeywords(keywords) {
  if (keywords.length === 0) {
    blockedKeywordsListEl.innerHTML = '<div class="blocked-empty">No blocked keywords</div>';
    return;
  }

  blockedKeywordsListEl.innerHTML = keywords
    .map(
      (kw) => `
    <div class="blocked-item">
      <span class="blocked-name">${escapeHtml(kw)}</span>
      <button class="blocked-remove" data-keyword="${escapeHtml(kw)}" title="Remove">&times;</button>
    </div>
  `
    )
    .join("");

  blockedKeywordsListEl.querySelectorAll(".blocked-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const keyword = btn.dataset.keyword;
      const { settings = {} } = await chrome.storage.local.get("settings");
      settings.blockedKeywords = (settings.blockedKeywords || []).filter(
        (k) => k.toLowerCase() !== keyword.toLowerCase()
      );
      await chrome.storage.local.set({ settings });
      load();
    });
  });
}

// Feature 5: Analytics rendering
function renderAnalytics(videoCounts, threshold) {
  const entries = Object.entries(videoCounts);
  const filtered = entries.filter(([, e]) => e.count >= threshold && !e.clicked);

  // Summary
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const filteredToday = filtered.filter(([, e]) => (e.lastSeen || 0) >= todayMs);

  // Daily average: look at the span of days from first entry to now
  let earliestSeen = now;
  for (const [, e] of entries) {
    if (e.firstSeen && e.firstSeen < earliestSeen) earliestSeen = e.firstSeen;
  }
  const daySpan = Math.max(1, Math.ceil((now - earliestSeen) / (1000 * 60 * 60 * 24)));
  const dailyAvg = filtered.length > 0 ? (filtered.length / daySpan).toFixed(1) : "0";

  analyticsTotal.textContent = filtered.length;
  analyticsToday.textContent = filteredToday.length;
  analyticsAvg.textContent = dailyAvg;

  // Top 5 filtered channels
  const channelCounts = {};
  for (const [, e] of filtered) {
    const ch = e.channelName || "Unknown";
    channelCounts[ch] = (channelCounts[ch] || 0) + 1;
  }

  const topChannels = Object.entries(channelCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (topChannels.length === 0) {
    analyticsChannels.innerHTML = '<div class="empty-msg">No data yet</div>';
  } else {
    const maxCount = topChannels[0][1];
    analyticsChannels.innerHTML = topChannels
      .map(
        ([ch, count]) => `
      <div class="analytics-bar-row">
        <span class="analytics-bar-label">${escapeHtml(ch)}</span>
        <div class="analytics-bar-track">
          <div class="analytics-bar-fill" style="width: ${Math.round((count / maxCount) * 100)}%"></div>
        </div>
        <span class="analytics-bar-count">${count}</span>
      </div>
    `
      )
      .join("");
  }

  // Last 7 days chart
  const dayLabels = [];
  const dayCounts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    d.setHours(0, 0, 0, 0);
    const dayStart = d.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const label = d.toLocaleDateString(undefined, { weekday: "short" });
    dayLabels.push(label);

    let count = 0;
    for (const [, e] of filtered) {
      const ls = e.lastSeen || 0;
      if (ls >= dayStart && ls < dayEnd) count++;
    }
    dayCounts.push(count);
  }

  const maxDay = Math.max(...dayCounts, 1);
  analyticsChart.innerHTML = dayCounts
    .map(
      (count, i) => `
    <div class="analytics-day-col">
      <div class="analytics-day-bar-wrap">
        <div class="analytics-day-bar" style="height: ${Math.round((count / maxDay) * 100)}%">${count > 0 ? count : ""}</div>
      </div>
      <span class="analytics-day-label">${dayLabels[i]}</span>
    </div>
  `
    )
    .join("");
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
    accentColor: sAccentColor.value,
    retentionDays: parseInt(sRetention.value, 10),
    protectUpcoming: sProtectUpcoming.checked,
    protectLive: sProtectLive.checked,
    protectPremiere: sProtectPremiere.checked,
    protectPlaylist: sProtectPlaylist.checked,
    protectSubscribed: sProtectSubscribed.checked,
    blockedCategories: {
      shorts: sCatShorts.checked,
      music: sCatMusic.checked,
      gaming: sCatGaming.checked,
      news: sCatNews.checked,
      sports: sCatSports.checked,
    },
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
sAccentColor.addEventListener("input", saveSettings);
sRetention.addEventListener("change", saveSettings);
sRetention.addEventListener("input", saveSettings);
sProtectUpcoming.addEventListener("change", saveSettings);
sProtectLive.addEventListener("change", saveSettings);
sProtectPremiere.addEventListener("change", saveSettings);
sProtectPlaylist.addEventListener("change", saveSettings);
sProtectSubscribed.addEventListener("change", saveSettings);

// Category blocking listeners
sCatShorts.addEventListener("change", saveSettings);
sCatMusic.addEventListener("change", saveSettings);
sCatGaming.addEventListener("change", saveSettings);
sCatNews.addEventListener("change", saveSettings);
sCatSports.addEventListener("change", saveSettings);

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

// Feature 1: Block keyword
blockKeywordBtn.addEventListener("click", async () => {
  const kw = blockKeywordInput.value.trim();
  if (!kw) return;

  const { settings = {} } = await chrome.storage.local.get("settings");
  const list = settings.blockedKeywords || [];
  if (!list.some((k) => k.toLowerCase() === kw.toLowerCase())) {
    list.push(kw);
    settings.blockedKeywords = list;
    await chrome.storage.local.set({ settings });
  }
  blockKeywordInput.value = "";
  load();
});

blockKeywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") blockKeywordBtn.click();
});

// Init
load();
