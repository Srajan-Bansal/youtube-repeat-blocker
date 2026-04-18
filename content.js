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

  // --- Context check ---
  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

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
    const badges = renderer.querySelectorAll(
      "ytd-badge-supported-renderer, .badge-style-type-live-now, .badge-style-type-upcoming, [overlay-style='UPCOMING'], [overlay-style='LIVE']"
    );
    const badgeTexts = [];
    badges.forEach((b) => badgeTexts.push(b.textContent?.trim().toLowerCase() || ""));
    const allBadgeText = badgeTexts.join(" ");

    const overlayText = (
      renderer.querySelector("ytd-thumbnail-overlay-time-status-renderer")?.getAttribute("overlay-style") || ""
    ).toLowerCase();

    if (
      overlayText === "live" ||
      allBadgeText.includes("live") ||
      renderer.querySelector('[aria-label*="LIVE" i], .badge-style-type-live-now-alternate')
    ) {
      return "live";
    }

    if (
      overlayText === "upcoming" ||
      allBadgeText.includes("upcoming") ||
      allBadgeText.includes("scheduled") ||
      renderer.querySelector('[overlay-style="UPCOMING"]')
    ) {
      return "upcoming";
    }

    if (
      allBadgeText.includes("premiere") ||
      overlayText === "premiere" ||
      renderer.querySelector('[aria-label*="Premiere" i]')
    ) {
      return "premiere";
    }

    const link = renderer.querySelector('a[href*="list="]');
    if (link) {
      return "playlist";
    }

    return "video";
  }

  function isSubscribedChannel(renderer) {
    const subscribedBadge = renderer.querySelector(
      'button[aria-label*="notification" i], .ytd-subscription-notification-toggle-button-renderer'
    );
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

  // --- Feature 1: Keyword blocking ---

  function isKeywordBlocked(title, keywords) {
    if (!title || !keywords || keywords.length === 0) return false;
    const lower = title.toLowerCase();
    return keywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  // --- Feature 6: Category detection ---

  function detectCategory(renderer) {
    const categories = [];

    // Shorts detection
    const shortsLink = renderer.querySelector('a[href*="/shorts/"]');
    const overlayStyle = renderer.querySelector("ytd-thumbnail-overlay-time-status-renderer")?.getAttribute("overlay-style") || "";
    if (shortsLink || overlayStyle.toUpperCase() === "SHORTS") {
      categories.push("shorts");
    }

    // Check badge text for category hints
    const badges = renderer.querySelectorAll("ytd-badge-supported-renderer");
    const allBadgeText = Array.from(badges).map(b => b.textContent?.trim().toLowerCase() || "").join(" ");

    // Music detection
    if (
      allBadgeText.includes("music") ||
      renderer.querySelector('[badge-style*="MUSIC" i]') ||
      renderer.querySelector('a[href*="music.youtube.com"]')
    ) {
      categories.push("music");
    }

    // Gaming detection
    if (
      allBadgeText.includes("gaming") ||
      renderer.querySelector('[badge-style*="GAMING" i]')
    ) {
      categories.push("gaming");
    }

    // News detection
    if (
      allBadgeText.includes("news") ||
      renderer.querySelector('[badge-style*="NEWS" i]')
    ) {
      categories.push("news");
    }

    // Sports detection
    if (
      allBadgeText.includes("sports") ||
      allBadgeText.includes("sport") ||
      renderer.querySelector('[badge-style*="SPORTS" i]')
    ) {
      categories.push("sports");
    }

    return categories;
  }

  function isCategoryBlocked(renderer, settings) {
    const blocked = settings.blockedCategories || {};
    const categories = detectCategory(renderer);

    for (const cat of categories) {
      if (blocked[cat]) return cat;
    }
    return null;
  }

  // --- Apply settings to sidebar appearance ---

  async function loadSettings() {
    if (!isContextValid()) return {};
    try {
      const { settings = {} } = await chrome.storage.local.get("settings");
      currentSettings = settings;
      return settings;
    } catch {
      return {};
    }
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

    // Accent color
    const accent = settings.accentColor || "#c62828";
    sidebarEl.style.setProperty("--ytf-accent", accent);

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

  // --- Feature 2: Sidebar sorting ---

  function sortSidebarCards(sortBy) {
    if (!sidebarListEl) return;
    const cards = Array.from(sidebarListEl.querySelectorAll(".ytf-sidebar-card"));
    if (cards.length === 0) return;

    cards.sort((a, b) => {
      switch (sortBy) {
        case "count":
          return (parseInt(b.dataset.count) || 0) - (parseInt(a.dataset.count) || 0);
        case "date":
          return (parseInt(b.dataset.lastSeen) || 0) - (parseInt(a.dataset.lastSeen) || 0);
        case "channel":
          return (a.dataset.channel || "").localeCompare(b.dataset.channel || "");
        default:
          return 0;
      }
    });

    for (const card of cards) {
      sidebarListEl.appendChild(card);
    }
  }

  // --- Feature 3: Sidebar search filtering ---

  function filterSidebarCards(query) {
    if (!sidebarListEl) return;
    const cards = sidebarListEl.querySelectorAll(".ytf-sidebar-card");
    const lower = query.toLowerCase();

    cards.forEach((card) => {
      if (!lower) {
        card.style.display = "";
        return;
      }
      const title = (card.dataset.title || "").toLowerCase();
      const channel = (card.dataset.channel || "").toLowerCase();
      card.style.display = (title.includes(lower) || channel.includes(lower)) ? "" : "none";
    });
  }

  // --- Sidebar ---

  function createSidebar() {
    if (sidebarEl) return;

    sidebarEl = document.createElement("div");
    sidebarEl.id = "ytf-sidebar";

    const sortPref = currentSettings.sidebarSort || "count";

    sidebarEl.innerHTML = `
      <div class="ytf-sidebar-header">
        <span class="ytf-sidebar-header-text">Filtered (<span id="ytf-sidebar-count">0</span>)</span>
        <button class="ytf-sidebar-toggle" title="Collapse sidebar">&#x25B6;</button>
      </div>
      <div class="ytf-collapsed-badge" id="ytf-collapsed-badge">0</div>
      <div class="ytf-sidebar-controls">
        <div class="ytf-sidebar-search-wrap">
          <input type="text" class="ytf-sidebar-search" placeholder="Search filtered videos..." />
          <button class="ytf-sidebar-search-clear" title="Clear search">&times;</button>
        </div>
        <select class="ytf-sidebar-sort" title="Sort by">
          <option value="count"${sortPref === "count" ? " selected" : ""}>Sort: Count</option>
          <option value="date"${sortPref === "date" ? " selected" : ""}>Sort: Recent</option>
          <option value="channel"${sortPref === "channel" ? " selected" : ""}>Sort: Channel</option>
        </select>
      </div>
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

    // Feature 2: Sort dropdown
    const sortSelect = sidebarEl.querySelector(".ytf-sidebar-sort");
    sortSelect.addEventListener("change", () => {
      const sortBy = sortSelect.value;
      sortSidebarCards(sortBy);
      // Persist sort preference
      chrome.storage.local.get("settings", ({ settings = {} }) => {
        settings.sidebarSort = sortBy;
        chrome.storage.local.set({ settings });
        currentSettings = settings;
      });
    });

    // Feature 3: Search input
    const searchInput = sidebarEl.querySelector(".ytf-sidebar-search");
    const searchClear = sidebarEl.querySelector(".ytf-sidebar-search-clear");

    searchInput.addEventListener("input", () => {
      filterSidebarCards(searchInput.value);
      searchClear.style.display = searchInput.value ? "block" : "none";
    });

    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      filterSidebarCards("");
      searchClear.style.display = "none";
      searchInput.focus();
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

  function addToSidebar(videoId, entry, reason = "") {
    if (!sidebarListEl) return;

    const emptyMsg = sidebarListEl.querySelector(".ytf-sidebar-empty");
    if (emptyMsg) emptyMsg.remove();

    if (sidebarListEl.querySelector(`[data-video-id="${videoId}"]`)) return;

    const card = document.createElement("div");
    card.className = "ytf-sidebar-card";
    card.dataset.videoId = videoId;

    const title = entry.title || videoId;
    const channel = entry.channelName || "Unknown";
    const countNum = typeof entry.count === "number" ? entry.count : 0;

    // Data attributes for sorting & search
    card.dataset.count = countNum;
    card.dataset.lastSeen = entry.lastSeen || 0;
    card.dataset.channel = channel;
    card.dataset.title = title;

    const countText = reason ? reason : `seen ${entry.count}x`;

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
      try {
        chrome.storage.local.get("videoCounts", ({ videoCounts = {} }) => {
          if (videoCounts[videoId]) {
            videoCounts[videoId].clicked = true;
            chrome.storage.local.set({ videoCounts });
          }
        });
      } catch {}

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

    // Apply current search filter to new card
    const searchInput = sidebarEl?.querySelector(".ytf-sidebar-search");
    if (searchInput && searchInput.value) {
      filterSidebarCards(searchInput.value);
    }
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
    if (!isHomePage() || !isContextValid()) return;
    try {
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
      const blockedKeywords = settings.blockedKeywords || [];
      const now = Date.now();

      // Feature 6: Hide shorts shelf renderers if shorts blocked
      if (enabled && settings.blockedCategories?.shorts) {
        document.querySelectorAll("ytd-reel-shelf-renderer").forEach((shelf) => {
          shelf.style.display = "none";
        });
      } else {
        document.querySelectorAll("ytd-reel-shelf-renderer").forEach((shelf) => {
          shelf.style.display = "";
        });
      }

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
        const title = entry?.title || "";

        // Check if this content type is protected
        const protected_ = isProtected(renderer, settings);

        // Check blocking reasons
        const thresholdHit =
          enabled && entry && entry.count >= threshold && !entry.clicked;
        const channelBlocked =
          enabled && isChannelBlocked(channelName, blockedChannels);
        const keywordBlocked =
          enabled && isKeywordBlocked(title, blockedKeywords);
        const categoryBlock =
          enabled ? isCategoryBlocked(renderer, settings) : null;

        // Keyword blocking and category blocking override content protection
        const shouldHide =
          (keywordBlocked || categoryBlock)
            ? true
            : ((thresholdHit || channelBlocked) && !protected_);

        if (shouldHide) {
          renderer.classList.add("ytf-hidden");
          let reason = "";
          if (categoryBlock) reason = categoryBlock;
          else if (keywordBlocked) reason = "keyword";
          else if (channelBlocked) reason = "blocked";
          else reason = "";

          const displayEntry = reason
            ? { ...entry, count: entry?.count || 0 }
            : entry;
          const reasonText = reason
            ? reason
            : `seen ${entry?.count}x`;
          addToSidebar(videoId, displayEntry, reasonText);
          log(
            `HIDDEN: "${title}" (${videoId}), reason: ${reason || "count=" + entry?.count}`
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

      // Sort after scan
      const sortPref = settings.sidebarSort || "count";
      sortSidebarCards(sortPref);

      try {
        chrome.runtime.sendMessage({ type: "updateBadge", filteredCount });
      } catch {}
    } catch (e) {
      if (e.message?.includes("Extension context invalidated")) {
        log("Extension context invalidated, stopping.");
        stopObserver();
      } else {
        throw e;
      }
    }
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
      document.querySelector("ytd-browse[page-subtype='home']") ||
      document.querySelector("#primary") ||
      document.querySelector("ytd-rich-grid-renderer") ||
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
      document.querySelectorAll("[data-ytf-processed]").forEach((el) => {
        el.removeAttribute("data-ytf-processed");
        el.classList.remove("ytf-hidden");
      });
      clearSidebar();
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
  document.addEventListener("yt-page-data-updated", () => {
    log("yt-page-data-updated");
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
    if (!isContextValid()) return;
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
