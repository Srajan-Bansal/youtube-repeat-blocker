(() => {
  const countedThisSession = new Set();
  let observer = null;
  let scanTimer = null;
  let initialScanTimer = null;
  let sidebarEl = null;
  let sidebarListEl = null;
  let sidebarCountEl = null;
  let collapsedBadgeEl = null;
  let currentSettings = {};

  // --- Debug logging ---
  function log(...args) {
    console.log("[YT Feed Filter]", ...args);
  }

  // --- Helpers ---

  function isHomePage() {
    const path = location.pathname;
    return path === "/" || path === "/feed/recommended";
  }

  function extractVideoId(renderer) {
    const link =
      renderer.querySelector('a#thumbnail[href*="watch"]') ||
      renderer.querySelector('a[href*="watch?v="]') ||
      renderer.querySelector('a.ytd-thumbnail[href*="watch"]');
    if (!link) return null;
    try {
      const url = new URL(link.href, location.origin);
      return url.searchParams.get("v");
    } catch {
      return null;
    }
  }

  function extractMetadata(renderer) {
    const titleEl =
      renderer.querySelector("#video-title") ||
      renderer.querySelector("#video-title-link") ||
      renderer.querySelector("h3 a");
    const channelEl =
      renderer.querySelector("ytd-channel-name #text") ||
      renderer.querySelector("#channel-name #text") ||
      renderer.querySelector("#channel-name a");
    return {
      title: titleEl?.textContent?.trim() || "",
      channelName: channelEl?.textContent?.trim() || "",
    };
  }

  // --- Content type detection ---

  function detectContentType(renderer) {
    // Check for live / upcoming / premiere badges
    const badges = renderer.querySelectorAll(
      "ytd-badge-supported-renderer, .badge-style-type-live-now, .badge-style-type-upcoming, [overlay-style='UPCOMING'], [overlay-style='LIVE']"
    );
    const badgeTexts = [];
    badges.forEach((b) => badgeTexts.push(b.textContent?.trim().toLowerCase() || ""));
    const allBadgeText = badgeTexts.join(" ");

    // Check overlay/thumbnail indicators
    const overlayText = (
      renderer.querySelector("ytd-thumbnail-overlay-time-status-renderer")?.getAttribute("overlay-style") || ""
    ).toLowerCase();

    // Live stream (currently live)
    if (
      overlayText === "live" ||
      allBadgeText.includes("live") ||
      renderer.querySelector('[aria-label*="LIVE" i], .badge-style-type-live-now-alternate')
    ) {
      return "live";
    }

    // Upcoming stream (scheduled)
    if (
      overlayText === "upcoming" ||
      allBadgeText.includes("upcoming") ||
      allBadgeText.includes("scheduled") ||
      renderer.querySelector('[overlay-style="UPCOMING"]')
    ) {
      return "upcoming";
    }

    // Premiere
    if (
      allBadgeText.includes("premiere") ||
      overlayText === "premiere" ||
      renderer.querySelector('[aria-label*="Premiere" i]')
    ) {
      return "premiere";
    }

    // Playlist / Mix
    const link = renderer.querySelector('a[href*="list="]');
    if (link) {
      return "playlist";
    }

    return "video";
  }

  function isSubscribedChannel(renderer) {
    // YouTube shows a notification bell or "subscribed" indicator for subscribed channels
    // The owner text area sometimes has a subscriber badge
    const subscribedBadge = renderer.querySelector(
      'button[aria-label*="notification" i], .ytd-subscription-notification-toggle-button-renderer'
    );
    // Also check for the verified/subscribed indicator dot
    const ownerBadges = renderer.querySelectorAll("ytd-badge-supported-renderer");
    for (const badge of ownerBadges) {
      const label = badge.getAttribute("aria-label")?.toLowerCase() || "";
      if (label.includes("subscribed")) return true;
    }
    return !!subscribedBadge;
  }

  function isProtected(renderer, settings) {
    const type = detectContentType(renderer);

    if (type === "upcoming" && settings.protectUpcoming !== false) return true;
    if (type === "live" && settings.protectLive !== false) return true;
    if (type === "premiere" && settings.protectPremiere !== false) return true;
    if (type === "playlist" && settings.protectPlaylist !== false) return true;
    if (settings.protectSubscribed !== false && isSubscribedChannel(renderer)) return true;

    return false;
  }

  // --- Apply settings to sidebar appearance ---

  async function loadSettings() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    currentSettings = settings;
    return settings;
  }

  function applySidebarSettings(settings) {
    if (!sidebarEl) return;

    // Position
    const pos = settings.sidebarPosition || "right";
    sidebarEl.classList.toggle("ytf-sidebar-left", pos === "left");
    document.body.classList.toggle("ytf-sidebar-left", pos === "left");

    // Width
    const width = settings.sidebarWidth || 360;
    if (!sidebarEl.classList.contains("ytf-collapsed")) {
      sidebarEl.style.width = width + "px";
    }

    // Theme override
    const theme = settings.theme || "auto";
    sidebarEl.classList.remove("ytf-theme-light", "ytf-theme-dark");
    if (theme === "light") sidebarEl.classList.add("ytf-theme-light");
    else if (theme === "dark") sidebarEl.classList.add("ytf-theme-dark");

    // Auto-collapse
    if (settings.autoCollapse && !sidebarEl.dataset.userToggled) {
      sidebarEl.classList.add("ytf-collapsed");
      document.body.classList.add("ytf-sidebar-collapsed");
      document.body.classList.remove("ytf-sidebar-active");
      const toggleBtn = sidebarEl.querySelector(".ytf-sidebar-toggle");
      if (toggleBtn) {
        toggleBtn.innerHTML = pos === "left" ? "&#x25B6;" : "&#x25C0;";
      }
    }
  }

  // --- Sidebar ---

  function createSidebar() {
    if (sidebarEl) return;

    sidebarEl = document.createElement("div");
    sidebarEl.id = "ytf-sidebar";

    sidebarEl.innerHTML = `
      <div class="ytf-sidebar-header">
        <span class="ytf-sidebar-header-text">Filtered (<span id="ytf-sidebar-count">0</span>)</span>
        <button class="ytf-sidebar-toggle" title="Collapse sidebar">&#x25B6;</button>
      </div>
      <div class="ytf-collapsed-badge" id="ytf-collapsed-badge">0</div>
      <div class="ytf-sidebar-list">
        <div class="ytf-sidebar-empty">No filtered videos yet.<br>Reload a few times!</div>
      </div>
    `;

    document.body.appendChild(sidebarEl);
    document.body.classList.add("ytf-sidebar-active");

    sidebarListEl = sidebarEl.querySelector(".ytf-sidebar-list");
    sidebarCountEl = sidebarEl.querySelector("#ytf-sidebar-count");
    collapsedBadgeEl = sidebarEl.querySelector("#ytf-collapsed-badge");

    // Toggle collapse
    const toggleBtn = sidebarEl.querySelector(".ytf-sidebar-toggle");
    toggleBtn.addEventListener("click", () => {
      sidebarEl.dataset.userToggled = "true";
      const collapsed = sidebarEl.classList.toggle("ytf-collapsed");
      document.body.classList.toggle("ytf-sidebar-collapsed", collapsed);
      document.body.classList.toggle("ytf-sidebar-active", !collapsed);

      const pos = currentSettings.sidebarPosition || "right";
      if (collapsed) {
        toggleBtn.innerHTML = pos === "left" ? "&#x25B6;" : "&#x25C0;";
        toggleBtn.title = "Expand sidebar";
        sidebarEl.style.width = "";
      } else {
        toggleBtn.innerHTML = pos === "left" ? "&#x25C0;" : "&#x25B6;";
        toggleBtn.title = "Collapse sidebar";
        const width = currentSettings.sidebarWidth || 360;
        sidebarEl.style.width = width + "px";
      }
    });

    applySidebarSettings(currentSettings);
    log("Sidebar created");
  }

  function showSidebar() {
    if (!sidebarEl) createSidebar();
    sidebarEl.style.display = "";
    if (!sidebarEl.classList.contains("ytf-collapsed")) {
      document.body.classList.add("ytf-sidebar-active");
    }
  }

  function hideSidebar() {
    if (sidebarEl) {
      sidebarEl.style.display = "none";
    }
    document.body.classList.remove(
      "ytf-sidebar-active",
      "ytf-sidebar-collapsed"
    );
  }

  function addToSidebar(videoId, entry) {
    if (!sidebarListEl) return;

    // Remove empty state message
    const emptyMsg = sidebarListEl.querySelector(".ytf-sidebar-empty");
    if (emptyMsg) emptyMsg.remove();

    // Don't add duplicates
    if (sidebarListEl.querySelector(`[data-video-id="${videoId}"]`)) return;

    const card = document.createElement("div");
    card.className = "ytf-sidebar-card";
    card.dataset.videoId = videoId;

    const title = entry.title || videoId;
    const channel = entry.channelName || "Unknown";

    card.innerHTML = `
      <img class="ytf-sidebar-thumb" src="https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg" alt="" loading="lazy"
           onerror="this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg'" />
      <div class="ytf-sidebar-info">
        <div class="ytf-sidebar-title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
        <div class="ytf-sidebar-channel">${escapeHtml(channel)}</div>
      </div>
      <div class="ytf-sidebar-bottom">
        <span class="ytf-sidebar-count">seen ${entry.count}x</span>
        <button class="ytf-sidebar-restore" title="Stop filtering this video">Show</button>
      </div>
    `;

    // Restore button
    card.querySelector(".ytf-sidebar-restore").addEventListener("click", () => {
      chrome.storage.local.get("videoCounts", ({ videoCounts = {} }) => {
        if (videoCounts[videoId]) {
          videoCounts[videoId].clicked = true;
          chrome.storage.local.set({ videoCounts });
        }
      });

      const renderer = findRendererByVideoId(videoId);
      if (renderer) renderer.classList.remove("ytf-hidden");

      card.remove();
      updateSidebarCount();

      if (!sidebarListEl.querySelector(".ytf-sidebar-card")) {
        sidebarListEl.innerHTML =
          '<div class="ytf-sidebar-empty">No filtered videos yet.<br>Reload a few times!</div>';
      }
    });

    // Click thumbnail/title to watch
    const thumb = card.querySelector(".ytf-sidebar-thumb");
    const titleEl = card.querySelector(".ytf-sidebar-title");
    for (const el of [thumb, titleEl]) {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        window.location.href = `https://www.youtube.com/watch?v=${videoId}`;
      });
    }

    sidebarListEl.appendChild(card);
    updateSidebarCount();
  }

  function removeFromSidebar(videoId) {
    if (!sidebarListEl) return;
    const card = sidebarListEl.querySelector(`[data-video-id="${videoId}"]`);
    if (card) {
      card.remove();
      updateSidebarCount();
    }
  }

  function updateSidebarCount() {
    const count = sidebarListEl
      ? sidebarListEl.querySelectorAll(".ytf-sidebar-card").length
      : 0;
    if (sidebarCountEl) sidebarCountEl.textContent = count;
    if (collapsedBadgeEl) collapsedBadgeEl.textContent = count;
  }

  function clearSidebar() {
    if (sidebarListEl) {
      sidebarListEl.innerHTML =
        '<div class="ytf-sidebar-empty">No filtered videos yet.<br>Reload a few times!</div>';
      updateSidebarCount();
    }
  }

  function findRendererByVideoId(videoId) {
    const renderers = document.querySelectorAll("ytd-rich-item-renderer");
    for (const r of renderers) {
      const id = extractVideoId(r);
      if (id === videoId) return r;
    }
    return null;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // --- Check if channel is blocked ---

  function isChannelBlocked(channelName, blockedChannels) {
    if (!channelName || !blockedChannels || blockedChannels.length === 0)
      return false;
    const lower = channelName.toLowerCase();
    return blockedChannels.some((b) => lower === b.toLowerCase());
  }

  // --- Core scan ---

  async function scanFeed({ skipCounting = false } = {}) {
    if (!isHomePage()) return;

    const allRenderers = document.querySelectorAll("ytd-rich-item-renderer");
    const unprocessed = document.querySelectorAll(
      "ytd-rich-item-renderer:not([data-ytf-processed])"
    );

    log(`Scan: ${allRenderers.length} total, ${unprocessed.length} new`);

    if (unprocessed.length === 0 && !skipCounting) return;

    const { videoCounts = {}, settings = {} } = await chrome.storage.local.get([
      "videoCounts",
      "settings",
    ]);
    currentSettings = settings;

    const threshold = settings.threshold || 3;
    const enabled = settings.enabled !== false;
    const blockedChannels = settings.blockedChannels || [];
    const now = Date.now();

    const toProcess = skipCounting ? allRenderers : unprocessed;

    for (const renderer of toProcess) {
      renderer.setAttribute("data-ytf-processed", "true");
      const videoId = extractVideoId(renderer);
      if (!videoId) continue;

      // Update count
      if (!skipCounting && !countedThisSession.has(videoId)) {
        countedThisSession.add(videoId);
        const existing = videoCounts[videoId] || {
          count: 0,
          firstSeen: now,
          clicked: false,
        };
        existing.count++;
        existing.lastSeen = now;
        const meta = extractMetadata(renderer);
        existing.title = meta.title || existing.title || "";
        existing.channelName = meta.channelName || existing.channelName || "";
        videoCounts[videoId] = existing;
        log(`Video "${existing.title}" (${videoId}): count=${existing.count}`);
      }

      const entry = videoCounts[videoId];
      const channelName = entry?.channelName || "";

      // Check if this content type is protected
      const protected_ = isProtected(renderer, settings);

      // Check if should be hidden: threshold reached OR channel blocked
      const thresholdHit =
        enabled && entry && entry.count >= threshold && !entry.clicked;
      const channelBlocked =
        enabled && isChannelBlocked(channelName, blockedChannels);

      if ((thresholdHit || channelBlocked) && !protected_) {
        renderer.classList.add("ytf-hidden");
        const reason = channelBlocked
          ? { ...entry, count: `blocked` }
          : entry;
        addToSidebar(videoId, reason, channelBlocked);
        log(
          `HIDDEN: "${entry?.title}" (${videoId}), ${channelBlocked ? "channel blocked" : "count=" + entry?.count}`
        );
      } else {
        renderer.classList.remove("ytf-hidden");
        removeFromSidebar(videoId);
      }
    }

    const filteredCount = document.querySelectorAll(
      "ytd-rich-item-renderer.ytf-hidden"
    ).length;

    if (!skipCounting) {
      await chrome.storage.local.set({ videoCounts });
      log(
        `Saved ${Object.keys(videoCounts).length} videos. Filtered: ${filteredCount}`
      );
    }

    try {
      chrome.runtime.sendMessage({ type: "updateBadge", filteredCount });
    } catch {}
  }

  // Override addToSidebar to handle blocked channels
  const _origAddToSidebar = addToSidebar;
  // Actually, let me just modify the card creation inline

  // Re-define addToSidebar with blocked support
  function addToSidebar(videoId, entry, isBlocked = false) {
    if (!sidebarListEl) return;

    const emptyMsg = sidebarListEl.querySelector(".ytf-sidebar-empty");
    if (emptyMsg) emptyMsg.remove();

    if (sidebarListEl.querySelector(`[data-video-id="${videoId}"]`)) return;

    const card = document.createElement("div");
    card.className = "ytf-sidebar-card";
    card.dataset.videoId = videoId;

    const title = entry.title || videoId;
    const channel = entry.channelName || "Unknown";
    const countText = isBlocked ? "blocked" : `seen ${entry.count}x`;

    card.innerHTML = `
      <img class="ytf-sidebar-thumb" src="https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg" alt="" loading="lazy"
           onerror="this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg'" />
      <div class="ytf-sidebar-info">
        <div class="ytf-sidebar-title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
        <div class="ytf-sidebar-channel">${escapeHtml(channel)}</div>
      </div>
      <div class="ytf-sidebar-bottom">
        <span class="ytf-sidebar-count">${countText}</span>
        <button class="ytf-sidebar-restore" title="Stop filtering this video">Show</button>
      </div>
    `;

    card.querySelector(".ytf-sidebar-restore").addEventListener("click", () => {
      chrome.storage.local.get("videoCounts", ({ videoCounts = {} }) => {
        if (videoCounts[videoId]) {
          videoCounts[videoId].clicked = true;
          chrome.storage.local.set({ videoCounts });
        }
      });

      const renderer = findRendererByVideoId(videoId);
      if (renderer) renderer.classList.remove("ytf-hidden");

      card.remove();
      updateSidebarCount();

      if (!sidebarListEl.querySelector(".ytf-sidebar-card")) {
        sidebarListEl.innerHTML =
          '<div class="ytf-sidebar-empty">No filtered videos yet.<br>Reload a few times!</div>';
      }
    });

    const thumb = card.querySelector(".ytf-sidebar-thumb");
    const titleEl = card.querySelector(".ytf-sidebar-title");
    for (const el of [thumb, titleEl]) {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        window.location.href = `https://www.youtube.com/watch?v=${videoId}`;
      });
    }

    sidebarListEl.appendChild(card);
    updateSidebarCount();
  }

  // --- Rescan ---

  function rescanAll() {
    document.querySelectorAll("[data-ytf-processed]").forEach((el) => {
      el.removeAttribute("data-ytf-processed");
      el.classList.remove("ytf-hidden");
    });
    clearSidebar();
    scanFeed({ skipCounting: true });
  }

  // --- Observer ---

  function startObserver() {
    if (observer) observer.disconnect();

    const target =
      document.querySelector("ytd-rich-grid-renderer #contents") ||
      document.querySelector("ytd-rich-grid-renderer") ||
      document.querySelector("ytd-browse[page-subtype='home']") ||
      document.querySelector("#primary") ||
      document.body;

    log("Observing:", target.tagName, target.id || "");

    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => scanFeed(), 400);
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // --- Wait for feed ---

  function waitForFeedAndScan() {
    log("Waiting for feed...");
    clearInterval(initialScanTimer);

    let attempts = 0;
    initialScanTimer = setInterval(() => {
      attempts++;
      const renderers = document.querySelectorAll("ytd-rich-item-renderer");
      log(`Attempt ${attempts}: ${renderers.length} renderers`);

      if (renderers.length > 0) {
        clearInterval(initialScanTimer);
        log("Feed loaded!");
        scanFeed();
        startObserver();
      } else if (attempts >= 30) {
        clearInterval(initialScanTimer);
        log("Timeout waiting for feed, starting observer");
        startObserver();
      }
    }, 500);
  }

  // --- Page change ---

  async function onPageChange() {
    log("Page change. URL:", location.href, "isHome:", isHomePage());
    countedThisSession.clear();
    stopObserver();

    await loadSettings();

    if (isHomePage()) {
      showSidebar();
      applySidebarSettings(currentSettings);
      waitForFeedAndScan();
    } else {
      hideSidebar();
    }
  }

  document.addEventListener("yt-navigate-finish", () => {
    log("yt-navigate-finish");
    onPageChange();
  });
  window.addEventListener("popstate", () => {
    log("popstate");
    onPageChange();
  });

  log("Content script loaded. URL:", location.href);
  loadSettings().then(() => {
    if (isHomePage()) createSidebar();
    onPageChange();
  });

  // --- Click detection ---

  document.addEventListener(
    "click",
    (e) => {
      const link = e.target.closest('a[href*="watch?v="]');
      if (!link) return;
      try {
        const url = new URL(link.href, location.origin);
        const videoId = url.searchParams.get("v");
        if (!videoId) return;

        log(`Clicked: ${videoId}`);
        chrome.storage.local.get("videoCounts", ({ videoCounts = {} }) => {
          if (videoCounts[videoId]) {
            videoCounts[videoId].clicked = true;
            chrome.storage.local.set({ videoCounts });
          }
        });
      } catch {}
    },
    true
  );

  // --- React to settings changes ---

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      loadSettings().then(() => {
        if (isHomePage()) {
          applySidebarSettings(currentSettings);
          rescanAll();
        }
      });
    } else if (changes.videoCounts) {
      if (isHomePage()) {
        rescanAll();
      }
    }
  });
})();
