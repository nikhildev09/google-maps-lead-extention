/* Google Maps page worker. It scrolls the result feed, opens profiles, and persists leads live. */
(function initContentScript() {
  "use strict";

  if (globalThis.__fdSmartMapsExtractorLoaded) {
    return;
  }
  globalThis.__fdSmartMapsExtractorLoaded = true;

  const FDX = globalThis.FDExtractor;

  let control = {
    running: false,
    paused: false,
    stopping: false,
    loopPromise: null
  };

  let stateCache = FDX.createEmptyState();
  let foundUrls = new Set();
  let processedMapUrls = new Set();
  let processedKeys = new Set();
  let sessionFailedMapUrls = new Set();
  let lastPersistAt = 0;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleCommand(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });

  // Auto resume covers Chrome suspending/reloading the tab while extraction is active.
  window.setTimeout(async () => {
    try {
      const stored = await FDX.getState();
      if (stored.status === "running" && isMapsPage()) {
        await startExtraction({ autoResume: true, settings: stored.settings });
      }
    } catch (error) {
      console.warn("FD Smart Maps auto resume failed", error);
    }
  }, 1800);

  async function handleCommand(message) {
    if (!message || !message.type) return { ok: false, error: "Unknown command" };

    switch (message.type) {
      case "FD_PING":
        return { ok: true, loaded: true };
      case "FD_START_EXTRACTION":
        return startExtraction(message.payload || {});
      case "FD_PAUSE_EXTRACTION":
        return pauseExtraction();
      case "FD_RESUME_EXTRACTION":
        return resumeExtraction();
      case "FD_STOP_EXTRACTION":
        return stopExtraction(message.payload || {});
      default:
        return { ok: false, error: `Unsupported command: ${message.type}` };
    }
  }

  async function startExtraction(payload = {}) {
    if (!isMapsPage()) {
      return { ok: false, error: "This extractor only runs on Google Maps pages." };
    }
    if (control.loopPromise && control.running) {
      return { ok: true, alreadyRunning: true };
    }

    const stored = await FDX.getState();
    const freshRun = !payload.autoResume;
    stateCache = FDX.normalizeState({
      ...stored,
      status: "running",
      statusText: payload.autoResume ? "Auto resumed" : "Starting extraction",
      stoppedAt: null,
      currentBusiness: "",
      totalFound: freshRun ? 0 : stored.totalFound,
      failedCount: freshRun ? 0 : stored.failedCount,
      failedItems: freshRun ? [] : stored.failedItems,
      foundMapUrls: freshRun ? [] : stored.foundMapUrls,
      processedMapUrls: freshRun ? mapsUrlsFromLeads(stored.leads) : stored.processedMapUrls,
      keyword: payload.keyword || detectSearchKeyword() || stored.keyword || "",
      settings: { ...stored.settings, ...(payload.settings || {}) }
    });

    if (!stateCache.startedAt || ["idle", "stopped", "completed"].includes(stored.status)) {
      stateCache.startedAt = Date.now();
      stateCache.elapsedMs = 0;
    }

    hydrateSetsFromState();
    sessionFailedMapUrls = new Set();
    control = {
      running: true,
      paused: false,
      stopping: false,
      loopPromise: null
    };

    addLog("info", payload.autoResume ? "Extraction auto resumed" : "Extraction started");
    await persistState(true);

    control.loopPromise = runExtractionLoop().finally(() => {
      control.loopPromise = null;
      control.running = false;
    });

    return { ok: true, started: true };
  }

  async function pauseExtraction() {
    const elapsed = currentElapsedMs();
    control.paused = true;
    stateCache.status = "paused";
    stateCache.statusText = "Paused";
    stateCache.elapsedMs = elapsed;
    addLog("info", "Extraction paused");
    await persistState(true);
    return { ok: true };
  }

  async function resumeExtraction() {
    control.paused = false;
    control.stopping = false;
    stateCache.status = "running";
    stateCache.statusText = "Resumed";
    if (!stateCache.startedAt) stateCache.startedAt = Date.now();
    addLog("info", "Extraction resumed");
    await persistState(true);

    if (!control.loopPromise) {
      control.running = true;
      control.loopPromise = runExtractionLoop().finally(() => {
        control.loopPromise = null;
        control.running = false;
      });
    }
    return { ok: true };
  }

  async function stopExtraction(payload = {}) {
    const elapsed = currentElapsedMs();
    control.stopping = true;
    control.paused = false;
    control.running = false;
    stateCache.status = "stopped";
    stateCache.statusText = payload.silent ? "Stopped" : "Stopped by user";
    stateCache.currentBusiness = "";
    stateCache.stoppedAt = Date.now();
    stateCache.elapsedMs = elapsed;
    if (!payload.silent) addLog("info", "Extraction stopped by user");
    await persistState(true);
    return { ok: true };
  }

  async function runExtractionLoop() {
    let idleRounds = 0;
    let lastFoundCount = foundUrls.size;

    try {
      while (!control.stopping) {
        await waitIfPaused();
        const feed = await waitForResultsFeed(12000);

        if (!feed) {
          if (isCurrentProfilePage()) {
            await processCurrentProfile();
            break;
          }

          stateCache.statusText = "Waiting for Google Maps results";
          addLog("warn", "Could not find Google Maps result feed");
          await persistState(true);
          await FDX.randomDelay(stateCache.settings);
          idleRounds += 1;
          if (idleRounds >= 3) break;
          continue;
        }

        const visibleItems = collectVisibleListings(feed);
        for (const item of visibleItems) {
          if (control.stopping) break;
          await waitIfPaused();
          if (processedMapUrls.has(item.mapsUrl)) continue;
          if (sessionFailedMapUrls.has(item.mapsUrl)) continue;
          await processListing(item);
        }

        if (control.stopping) break;

        const beforeScrollCount = foundUrls.size;
        await humanScroll(feed);
        await FDX.randomDelay(stateCache.settings);
        collectVisibleListings(feed);

        if (foundUrls.size === lastFoundCount || foundUrls.size === beforeScrollCount) {
          idleRounds += 1;
        } else {
          idleRounds = 0;
          lastFoundCount = foundUrls.size;
        }

        stateCache.statusText = `Scanning results (${foundUrls.size} found)`;
        await persistState();

        const endReached = isEndOfResultsVisible(feed);
        if ((endReached && idleRounds >= 2) || idleRounds >= 8) {
          break;
        }
      }

      if (!control.stopping) {
        const elapsed = currentElapsedMs();
        stateCache.status = "completed";
        stateCache.statusText = "Extraction completed";
        stateCache.currentBusiness = "";
        stateCache.stoppedAt = Date.now();
        stateCache.elapsedMs = elapsed;
        addLog("info", "Extraction completed", {
          found: stateCache.totalFound,
          extracted: stateCache.totalExtracted,
          failed: stateCache.failedCount
        });
        await persistState(true);
      }
    } catch (error) {
      stateCache.status = "error";
      stateCache.statusText = "Extraction hit an error, data is preserved";
      stateCache.currentBusiness = "";
      stateCache.elapsedMs = currentElapsedMs();
      addLog("error", "Extraction loop failed", { error: error.message || String(error) });
      await persistState(true);
    }
  }

  async function processListing(item) {
    const maxRetries = Math.max(0, Number(stateCache.settings.maxRetries) || 0);

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        stateCache.currentBusiness = item.name || "Business profile";
        stateCache.statusText = `Opening ${stateCache.currentBusiness}`;
        await persistState(true);

        const opened = await openListingProfile(item);
        if (!opened) throw new Error("Profile did not open");

        stateCache.statusText = `Extracting ${stateCache.currentBusiness}`;
        let lead = await extractProfileLeadWithScroll(item);

        if (lead.website && stateCache.settings.websiteScan) {
          stateCache.statusText = `Scanning website for ${lead.businessName || item.name}`;
          await persistState(true);
          lead = await enrichLeadFromWebsite(lead);
        }

        lead.leadScore = FDX.scoreLead(lead);
        lead.status = "Extracted";
        lead.extractedAt = FDX.nowIso();
        lead.keywordTag = stateCache.keyword || "";
        lead.whatsappOutreach = createWhatsAppOutreach(lead);

        const dedupKey = FDX.leadDedupKey(lead);
        if (dedupKey && processedKeys.has(dedupKey)) {
          addLog("info", "Duplicate skipped", { businessName: lead.businessName, dedupKey });
        } else {
          lead.id = lead.id || FDX.uniqueId("lead");
          if (dedupKey && hasLeadContactData(lead)) processedKeys.add(dedupKey);
          upsertLead(lead);
          stateCache.totalExtracted = stateCache.leads.length;
        }

        markProcessed(item.mapsUrl, lead.mapsUrl);
        stateCache.currentBusiness = "";
        stateCache.statusText = `Extracted ${lead.businessName || item.name || "business"}`;
        await persistState(true);
        await returnToResults();
        await FDX.randomDelay(stateCache.settings);
        return;
      } catch (error) {
        addLog("warn", "Profile extraction attempt failed", {
          businessName: item.name,
          mapsUrl: item.mapsUrl,
          attempt,
          error: error.message || String(error)
        });
        await returnToResults();
        if (attempt <= maxRetries) {
          await FDX.sleep(FDX.randomInt(1400, 2800));
        }
      }
    }

    stateCache.failedCount += 1;
    stateCache.failedItems = [
      ...(stateCache.failedItems || []),
      {
        id: FDX.uniqueId("failed"),
        businessName: item.name || "",
        mapsUrl: item.mapsUrl,
        failedAt: FDX.nowIso(),
        status: "Failed"
      }
    ].slice(-500);
    sessionFailedMapUrls.add(item.mapsUrl);
    stateCache.statusText = `Failed ${item.name || "business"}`;
    await persistState(true);
  }

  async function processCurrentProfile() {
    const seed = {
      name: getProfileName() || "Current business profile",
      mapsUrl: FDX.canonicalizeMapsUrl(location.href)
    };

    stateCache.currentBusiness = seed.name;
    stateCache.statusText = `Extracting ${seed.name}`;
    let lead = await extractProfileLeadWithScroll(seed);

    if (lead.website && stateCache.settings.websiteScan) {
      lead = await enrichLeadFromWebsite(lead);
    }

    lead.id = lead.id || FDX.uniqueId("lead");
    lead.leadScore = FDX.scoreLead(lead);
    lead.status = "Extracted";
    lead.extractedAt = FDX.nowIso();
    lead.keywordTag = stateCache.keyword || "";
    lead.whatsappOutreach = createWhatsAppOutreach(lead);

    const dedupKey = FDX.leadDedupKey(lead);
    if (!dedupKey || !processedKeys.has(dedupKey)) {
      if (dedupKey && hasLeadContactData(lead)) processedKeys.add(dedupKey);
      upsertLead(lead);
      stateCache.totalExtracted = stateCache.leads.length;
    }
    markProcessed(seed.mapsUrl, lead.mapsUrl);
    stateCache.totalFound = Math.max(stateCache.totalFound || 0, 1);
    stateCache.status = "completed";
    stateCache.statusText = "Current profile extracted";
    stateCache.currentBusiness = "";
    stateCache.stoppedAt = Date.now();
    stateCache.elapsedMs = currentElapsedMs();
    addLog("info", "Current Google Business Profile extracted", {
      businessName: lead.businessName,
      phone: Boolean(lead.phone),
      website: Boolean(lead.website)
    });
    await persistState(true);
  }

  function collectVisibleListings(feed) {
    const anchors = uniqueListingAnchors(feed);
    const items = [];

    for (const anchor of anchors) {
      const mapsUrl = FDX.canonicalizeMapsUrl(anchor.href);
      if (!mapsUrl || !mapsUrl.includes("/maps/place/")) continue;

      const name = listingNameFromAnchor(anchor);
      if (!name || isNonBusinessLink(name)) continue;
      const card = listingContainerFromAnchor(anchor);
      const seedDetails = extractListingCardDetails(card);

      if (!foundUrls.has(mapsUrl)) {
        foundUrls.add(mapsUrl);
      }
      items.push({ name, mapsUrl, ...seedDetails });
    }

    stateCache.foundMapUrls = [...foundUrls];
    stateCache.totalFound = foundUrls.size;
    return items;
  }

  function uniqueListingAnchors(feed) {
    const candidates = Array.from(
      feed.querySelectorAll('a[href*="/maps/place/"], a[href*="google.com/maps/place/"]')
    );
    const seen = new Set();
    const anchors = [];
    for (const anchor of candidates) {
      const url = FDX.canonicalizeMapsUrl(anchor.href);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      anchors.push(anchor);
    }
    return anchors;
  }

  async function openListingProfile(item) {
    const anchor = findListingAnchor(item.mapsUrl);
    if (!anchor) return false;

    anchor.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    await FDX.sleep(FDX.randomInt(350, 900));
    await realisticClick(anchor);

    return waitUntil(() => {
      const name = getProfileName();
      const profileUrl = FDX.canonicalizeMapsUrl(location.href);
      return Boolean(name) && (profileUrl.includes("/maps/place/") || profileUrl === item.mapsUrl);
    }, 18000, 350);
  }

  function findListingAnchor(mapsUrl) {
    const target = FDX.canonicalizeMapsUrl(mapsUrl);
    const feed = findResultsFeed();
    const anchors = uniqueListingAnchors(feed || document);
    return anchors.find((anchor) => FDX.canonicalizeMapsUrl(anchor.href) === target) || null;
  }

  async function extractCurrentProfile(seed) {
    const root = profileRoot();
    const mapsUrl = FDX.canonicalizeMapsUrl(location.href || seed.mapsUrl);
    const coords = FDX.extractCoordinates(location.href || seed.mapsUrl);
    const visibleText = root.innerText || document.body.innerText || "";
    const socialFromPage = collectSocialUrls(root);

    const lead = {
      businessName: getProfileName() || seed.name || "",
      phone: extractPhone(root) || seed.phone || "",
      website: extractWebsite(root) || seed.website || "",
      address: extractAddress(root),
      rating: extractRating(root),
      reviews: extractReviews(root),
      category: extractCategory(root),
      openingHours: extractOpeningHours(root),
      mapsUrl: mapsUrl || seed.mapsUrl,
      latitude: coords.latitude,
      longitude: coords.longitude,
      email: FDX.extractEmails(visibleText).join(", "),
      instagram: "",
      facebook: "",
      whatsapp: "",
      linkedin: "",
      status: "Extracting"
    };

    const social = FDX.mergeSocialLinks({}, socialFromPage);
    lead.instagram = social.instagram || "";
    lead.facebook = social.facebook || "";
    lead.whatsapp = social.whatsapp || "";
    lead.linkedin = social.linkedin || "";
    return lead;
  }

  async function extractProfileLeadWithScroll(seed) {
    await waitForProfileContactData(12000);
    await FDX.sleep(FDX.randomInt(700, 1400));

    let lead = await extractCurrentProfile(seed);
    if (lead.phone && lead.website) return lead;

    const scroller = findProfileScrollContainer();
    const originalTop = getScrollTop(scroller);
    const maxScrolls = 6;

    addLog("info", "Scanning profile panel for contact fields", {
      businessName: lead.businessName || seed.name || "",
      hasPhone: Boolean(lead.phone),
      hasWebsite: Boolean(lead.website)
    });

    for (let index = 0; index < maxScrolls && (!lead.phone || !lead.website); index += 1) {
      await scrollProfilePanel(scroller, index);
      await FDX.sleep(FDX.randomInt(650, 1300));
      lead = mergeLeadDetails(lead, await extractCurrentProfile(seed));
    }

    if (!lead.phone || !lead.website) {
      await FDX.sleep(FDX.randomInt(1500, 2600));
      lead = mergeLeadDetails(lead, await extractCurrentProfile(seed));
    }

    restoreProfileScroll(scroller, originalTop);
    return lead;
  }

  function mergeLeadDetails(primary, secondary) {
    const merged = { ...primary };
    Object.entries(secondary || {}).forEach(([key, value]) => {
      if ((merged[key] == null || merged[key] === "") && value) {
        merged[key] = value;
      }
    });
    return merged;
  }

  async function waitForProfileContactData(timeoutMs) {
    return waitUntil(() => {
      const root = profileRoot();
      if (!getProfileName()) return false;
      if (root.querySelector('a[href^="tel:"], [data-item-id^="phone:tel:"], [data-item-id="authority"]')) {
        return true;
      }
      const text = FDX.normalizeWhitespace(root.innerText || "");
      return /\b(Website|Phone|Call|Address|Directions)\b/i.test(text);
    }, timeoutMs, 350);
  }

  function findProfileScrollContainer() {
    const heading = document.querySelector("h1");
    const ancestor = firstScrollableAncestor(heading);
    if (ancestor) return ancestor;

    const root = profileRoot();
    if (isScrollable(root)) return root;

    const contactSelector = 'a[href^="tel:"], [data-item-id^="phone:tel:"], [data-item-id="authority"], a[aria-label*="Website" i]';
    const candidates = Array.from(document.querySelectorAll('div[role="main"], main, div[aria-label], div'))
      .filter((element) => isScrollable(element))
      .filter((element) => element.querySelector("h1") || element.querySelector(contactSelector))
      .sort((a, b) => b.clientHeight - a.clientHeight);

    return candidates[0] || document.scrollingElement || document.documentElement;
  }

  function firstScrollableAncestor(element) {
    let current = element;
    while (current && current !== document.body) {
      if (isScrollable(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function isScrollable(element) {
    return Boolean(element && element.scrollHeight > element.clientHeight + 120 && element.clientHeight > 180);
  }

  function getScrollTop(scroller) {
    if (!scroller) return 0;
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }
    return scroller.scrollTop || 0;
  }

  async function scrollProfilePanel(scroller, index) {
    const distance = FDX.randomInt(420, 780) + index * 60;
    if (!scroller || scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      window.scrollBy({ top: distance, behavior: "smooth" });
      return;
    }
    scroller.scrollBy({ top: distance, behavior: "smooth" });
  }

  function restoreProfileScroll(scroller, originalTop) {
    if (originalTop == null) return;
    try {
      if (!scroller || scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
        window.scrollTo({ top: originalTop, behavior: "smooth" });
      } else {
        scroller.scrollTo({ top: originalTop, behavior: "smooth" });
      }
    } catch (_error) {
      // A failed scroll restore is harmless; extraction data is already saved.
    }
  }

  async function enrichLeadFromWebsite(lead) {
    try {
      const response = await sendRuntimeMessage({
        type: "SCRAPE_WEBSITE",
        url: lead.website,
        options: { maxContactPages: 2, timeoutMs: 15000 }
      });

      const enrichment = response && response.enrichment;
      if (!response || !response.ok || !enrichment) {
        addLog("warn", "Website scan failed", { website: lead.website, error: response && response.error });
        return lead;
      }

      if (enrichment.error) {
        addLog(enrichment.permissionGranted ? "warn" : "info", "Website scan skipped or partial", {
          website: lead.website,
          error: enrichment.error
        });
      }

      const emails = [
        ...FDX.extractEmails(lead.email || ""),
        ...(enrichment.emails || [])
      ];
      const social = { ...enrichment.socialLinks };
      return {
        ...lead,
        email: [...new Set(emails)].join(", "),
        instagram: lead.instagram || social.instagram || "",
        facebook: lead.facebook || social.facebook || "",
        whatsapp: lead.whatsapp || social.whatsapp || "",
        linkedin: lead.linkedin || social.linkedin || ""
      };
    } catch (error) {
      addLog("warn", "Website enrichment message failed", {
        website: lead.website,
        error: error.message || String(error)
      });
      return lead;
    }
  }

  async function returnToResults() {
    const backButton = findBackButton();
    if (backButton) {
      await realisticClick(backButton);
    } else if (history.length > 1) {
      history.back();
    }
    await waitForResultsFeed(10000);
  }

  function findResultsFeed() {
    const selectors = [
      'div[role="feed"]',
      'div[aria-label*="Results for" i][role="feed"]',
      'div[aria-label*="Search results" i][role="feed"]',
      'div[aria-label*="Results" i][role="feed"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }

    const xpathFeed = findByXPath('//div[@role="feed" or contains(@aria-label, "Results")]');
    if (xpathFeed) return xpathFeed;

    // Fallback: the left pane is the tallest scrollable region with place links.
    const scrollables = Array.from(document.querySelectorAll("div"))
      .filter((element) => element.scrollHeight > element.clientHeight + 250)
      .filter((element) => element.querySelector('a[href*="/maps/place/"]'));
    return scrollables.sort((a, b) => b.clientHeight - a.clientHeight)[0] || null;
  }

  async function waitForResultsFeed(timeoutMs) {
    await waitUntil(() => Boolean(findResultsFeed()), timeoutMs, 300);
    return findResultsFeed();
  }

  function profileRoot() {
    const mains = Array.from(document.querySelectorAll('div[role="main"], main'));
    const withHeading = mains.find((element) => element.querySelector("h1"));
    if (withHeading) return withHeading;

    const withContact = mains.find((element) =>
      element.querySelector('a[href^="tel:"], [data-item-id^="phone:tel:"], [data-item-id="authority"], a[aria-label*="Website" i]')
    );
    if (withContact) return withContact;

    const heading = document.querySelector("h1");
    const panel = heading && heading.closest('div[role="main"], main, div[aria-label]');
    return panel || document.querySelector('div[role="main"]') || document.querySelector("main") || document.body;
  }

  function getProfileName() {
    const root = profileRoot();
    const heading =
      root.querySelector('h1[aria-level="1"]') ||
      root.querySelector("h1") ||
      document.querySelector('h1[aria-level="1"]') ||
      document.querySelector("h1") ||
      findByXPath('//h1[@aria-level="1" or self::h1]', root);
    return FDX.normalizeWhitespace(heading && heading.innerText);
  }

  function isCurrentProfilePage() {
    return location.pathname.includes("/maps/place/") && Boolean(getProfileName());
  }

  function extractAddress(root) {
    return cleanLabel(
      textFromFirst(root, [
        'button[data-item-id="address"]',
        'button[aria-label^="Address" i]',
        'div[aria-label^="Address" i]'
      ]),
      "Address"
    );
  }

  function extractPhone(root) {
    const tel = root.querySelector('a[href^="tel:"]');
    if (tel) {
      const phone = FDX.normalizePhone(tel.getAttribute("href").replace(/^tel:/i, ""));
      if (phone) return phone;
    }

    const itemWithTel = root.querySelector('[data-item-id^="phone:tel:"]');
    if (itemWithTel) {
      const fromItemId = (itemWithTel.getAttribute("data-item-id") || "").replace(/^phone:tel:/i, "");
      const phone = FDX.normalizePhone(decodeURIComponent(fromItemId));
      if (phone) return phone;
    }

    const contactElements = Array.from(
      root.querySelectorAll('button, a, div[role="button"], [aria-label], [data-tooltip], [data-item-id]')
    ).filter((element) => {
      const haystack = elementTextBundle(element);
      return /phone|call|tel:|copy phone|mobile/i.test(haystack);
    });

    for (const element of contactElements) {
      const phone = extractPhoneFromBundle(elementTextBundle(element));
      if (phone) return phone;
    }

    return extractLikelyPhoneFromProfileText(root.innerText || "");
  }

  function extractWebsite(root) {
    const preferredSelectors = [
      'a[data-item-id="authority"]',
      'a[aria-label*="Website" i]',
      'a[data-tooltip*="website" i]',
      'a[jsaction*="authority"]'
    ];

    for (const selector of preferredSelectors) {
      const link = root.querySelector(selector);
      const website = websiteFromLink(link);
      if (website) return website;
    }

    const links = Array.from(root.querySelectorAll('a[href]'));
    const labeledWebsite = links.find((link) =>
      /website|official site|open website|visit website/i.test(elementTextBundle(link))
    );
    const labeledResult = websiteFromLink(labeledWebsite);
    if (labeledResult) return labeledResult;

    const websiteControls = Array.from(
      root.querySelectorAll('button, a, div[role="button"], [aria-label], [data-tooltip], [data-item-id]')
    ).filter((element) => /website|official site|open website|visit website|authority/i.test(elementTextBundle(element)));

    for (const element of websiteControls) {
      const website = extractWebsiteFromBundle(elementTextBundle(element));
      if (website) return website;
    }

    for (const link of links) {
      const website = websiteFromLink(link);
      if (website) return website;
    }

    const textWebsite = extractWebsiteFromProfileText(root.innerText || "");
    if (textWebsite) return textWebsite;

    return "";
  }

  function elementTextBundle(element) {
    if (!element) return "";
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("data-item-id"),
      element.getAttribute("href"),
      element.innerText,
      element.textContent
    ]
      .filter(Boolean)
      .map((value) => {
        try {
          return decodeURIComponent(String(value));
        } catch (_error) {
          return String(value);
        }
      })
      .join(" ");
  }

  function extractPhoneFromBundle(bundle) {
    const text = FDX.normalizeWhitespace(bundle);
    const telMatch = text.match(/tel:\s*(\+?\d[\d\s().-]{5,}\d)/i);
    if (telMatch) {
      const phone = FDX.normalizePhone(telMatch[1]);
      if (phone) return phone;
    }

    const labelMatch = text.match(/(?:phone|call|mobile|tel)[^+\d]{0,24}(\+?\d[\d\s().-]{5,}\d)/i);
    if (labelMatch) {
      const phone = FDX.normalizePhone(labelMatch[1]);
      if (phone) return phone;
    }

    const candidates = text.match(/\+?\d[\d\s().-]{7,}\d/g) || [];
    for (const candidate of candidates) {
      const phone = FDX.normalizePhone(candidate);
      if (phone && phone.replace(/\D/g, "").length >= 8) return phone;
    }
    return "";
  }

  function extractLikelyPhoneFromProfileText(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => FDX.normalizeWhitespace(line))
      .filter(Boolean);

    const labeled = lines.find((line) => /phone|call|mobile|tel/i.test(line));
    const labeledPhone = extractPhoneFromBundle(labeled || "");
    if (labeledPhone) return labeledPhone;

    const candidates = lines
      .filter((line) => line.length <= 42)
      .filter((line) => !/review|rating|star|open|closed|hours|km|mi|route|street|road/i.test(line))
      .map(extractPhoneFromBundle)
      .filter(Boolean);

    return candidates[0] || "";
  }

  function websiteFromLink(link) {
    if (!link || !link.href) return "";
    const unwrapped = unwrapGoogleRedirectUrl(link.href);
    if (!isBusinessWebsiteUrl(unwrapped)) return "";
    return FDX.canonicalizeUrl(unwrapped);
  }

  function extractWebsiteFromBundle(bundle) {
    const text = FDX.normalizeWhitespace(bundle);
    const urlMatches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const match of urlMatches) {
      const website = FDX.canonicalizeUrl(unwrapGoogleRedirectUrl(match.replace(/[),.;]+$/, "")));
      if (isBusinessWebsiteUrl(website)) return website;
    }

    const domainMatches = text.match(/\b(?:www\.)?[a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9][a-z0-9-]{1,62})+\b(?:\/[^\s"'<>]*)?/gi) || [];
    for (const match of domainMatches) {
      const candidate = match.replace(/[),.;]+$/, "");
      const website = FDX.canonicalizeUrl(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
      if (isBusinessWebsiteUrl(website)) return website;
    }
    return "";
  }

  function extractWebsiteFromProfileText(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => FDX.normalizeWhitespace(line))
      .filter(Boolean);

    const labeled = lines.find((line) => /website|official site|visit website/i.test(line));
    const labeledWebsite = extractWebsiteFromBundle(labeled || "");
    if (labeledWebsite) return labeledWebsite;

    return "";
  }

  function unwrapGoogleRedirectUrl(rawUrl) {
    const href = FDX.safeUrl(rawUrl, location.href);
    if (!href) return "";

    try {
      const parsed = new URL(href);
      const isGoogleRedirect =
        parsed.hostname.endsWith("google.com") &&
        (/\/url$/i.test(parsed.pathname) ||
          parsed.pathname.includes("/url") ||
          parsed.pathname.includes("/local_url") ||
          parsed.pathname.includes("/aclk"));

      if (isGoogleRedirect) {
        for (const param of ["adurl", "q", "url", "u"]) {
          const value = parsed.searchParams.get(param);
          if (value && /^https?:\/\//i.test(value)) return value;
        }
      }
      return href;
    } catch (_error) {
      return "";
    }
  }

  function isBusinessWebsiteUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      if (host.endsWith("google.com") || host.endsWith("google.co.in")) return false;
      if (/googleusercontent|gstatic|googleapis|ggpht|schema\.org/i.test(host)) return false;
      if (/facebook\.com|fb\.com|instagram\.com|wa\.me|whatsapp\.com|linkedin\.com/i.test(host)) return false;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function extractRating(root) {
    const ratingElement = root.querySelector('[aria-label*="stars" i], [aria-label*="star" i]');
    const text = `${ratingElement ? ratingElement.getAttribute("aria-label") || ratingElement.innerText : ""}`;
    const match = text.match(/([0-5](?:\.\d+)?)\s*(?:star|stars)/i) || text.match(/\b([0-5](?:\.\d+)?)\b/);
    return match ? match[1] : "";
  }

  function extractReviews(root) {
    const candidates = Array.from(root.querySelectorAll('button[aria-label*="review" i], span[aria-label*="review" i]'));
    for (const element of candidates) {
      const text = `${element.getAttribute("aria-label") || ""} ${element.innerText || ""}`;
      const match = text.match(/([\d,.]+)\s*(?:review|reviews)/i);
      if (match) return match[1].replace(/[^\d]/g, "");
    }
    return "";
  }

  function extractCategory(root) {
    const direct = textFromFirst(root, [
      'button[jsaction*="category"]',
      'button[aria-label*="Category" i]'
    ]);
    if (direct) return cleanLabel(direct, "Category");

    const actionWords = /directions|save|nearby|send|share|call|website|reviews|photos|menu|order|book|suggest|claim/i;
    const buttons = Array.from(root.querySelectorAll("button"))
      .map((button) => FDX.normalizeWhitespace(button.innerText || button.getAttribute("aria-label") || ""))
      .filter((text) => text && text.length <= 48 && !actionWords.test(text));
    return buttons.find((text) => !/\d/.test(text)) || "";
  }

  function extractOpeningHours(root) {
    const hoursText = textFromFirst(root, [
      'button[data-item-id*="oh"]',
      'button[aria-label*="Hours" i]',
      'div[aria-label*="Hours" i]',
      'div[aria-label*="Monday" i]'
    ]);
    if (hoursText) return cleanLabel(hoursText, "Hours");

    const dayMatches = (root.innerText || "")
      .split(/\n+/)
      .map((line) => FDX.normalizeWhitespace(line))
      .filter((line) => /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(line));
    return dayMatches.slice(0, 7).join(" | ");
  }

  function textFromFirst(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (!element) continue;
      const text = FDX.normalizeWhitespace(element.getAttribute("aria-label") || element.innerText || element.textContent);
      if (text) return text;
    }
    return "";
  }

  function cleanLabel(value, label) {
    const text = FDX.normalizeWhitespace(value);
    return text.replace(new RegExp(`^${label}\\s*:?\\s*`, "i"), "").trim();
  }

  function collectSocialUrls(root) {
    return Array.from(root.querySelectorAll('a[href^="http"]'))
      .map((link) => link.href)
      .filter((href) => FDX.classifySocialUrl(href));
  }

  function createWhatsAppOutreach(lead) {
    if (lead.whatsapp) return lead.whatsapp;
    const digits = FDX.normalizePhone(lead.phone).replace(/\D/g, "");
    if (!digits) return "";
    const text = encodeURIComponent(`Hi ${lead.businessName || ""}, I found your business on Google Maps and wanted to connect.`);
    return `https://wa.me/${digits}?text=${text}`;
  }

  async function humanScroll(feed) {
    if (!feed) return false;
    const before = feed.scrollTop;
    const distance = FDX.randomInt(stateCache.settings.scrollStepMin, stateCache.settings.scrollStepMax);
    feed.scrollBy({ top: distance, behavior: "smooth" });
    await FDX.sleep(FDX.randomInt(900, 1600));
    if (Math.abs(feed.scrollTop - before) < 8) {
      feed.scrollTop = before + distance;
      await FDX.sleep(FDX.randomInt(700, 1200));
    }
    return Math.abs(feed.scrollTop - before) >= 8;
  }

  function isEndOfResultsVisible(feed) {
    const text = FDX.normalizeWhitespace(feed ? feed.innerText : document.body.innerText);
    return /you've reached the end of the list|end of results|no more results/i.test(text);
  }

  async function realisticClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = rect.left + Math.max(4, Math.min(rect.width - 4, rect.width * Math.random()));
    const y = rect.top + Math.max(4, Math.min(rect.height - 4, rect.height * Math.random()));
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
    await FDX.sleep(FDX.randomInt(160, 420));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }));
    await FDX.sleep(FDX.randomInt(90, 240));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    element.click();
  }

  function findBackButton() {
    return (
      document.querySelector('button[aria-label^="Back" i]') ||
      document.querySelector('button[jsaction*="back"]') ||
      findByXPath('//button[contains(translate(@aria-label, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "back")]')
    );
  }

  function listingNameFromAnchor(anchor) {
    const card = listingContainerFromAnchor(anchor);
    const label = anchor.getAttribute("aria-label") || (card && card.getAttribute("aria-label")) || anchor.innerText;
    return FDX.normalizeWhitespace(String(label || "").split("\n")[0]);
  }

  function listingContainerFromAnchor(anchor) {
    return anchor.closest('[role="article"]') || anchor.closest('div[jsaction*="mouseover"]') || anchor.closest("div");
  }

  function extractListingCardDetails(card) {
    if (!card) return { phone: "", website: "" };
    return {
      phone: extractPhone(card) || extractPhoneFromBundle(card.innerText || card.textContent || ""),
      website: extractWebsite(card)
    };
  }

  function isNonBusinessLink(name) {
    return /directions|website|call|save|share|route|view all/i.test(name);
  }

  function findByXPath(xpath, root = document) {
    try {
      const doc = root.ownerDocument || document;
      return doc.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (_error) {
      return null;
    }
  }

  async function waitUntil(predicate, timeoutMs = 10000, intervalMs = 250) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (predicate()) return true;
      await FDX.sleep(intervalMs);
    }
    return false;
  }

  async function waitIfPaused() {
    while (control.paused && !control.stopping) {
      await FDX.sleep(500);
    }
  }

  function markProcessed(...urls) {
    urls.filter(Boolean).forEach((url) => processedMapUrls.add(FDX.canonicalizeMapsUrl(url)));
    stateCache.processedMapUrls = [...processedMapUrls];
    stateCache.processedKeys = [...processedKeys];
  }

  function hydrateSetsFromState() {
    foundUrls = new Set(stateCache.foundMapUrls || []);
    processedMapUrls = new Set(stateCache.processedMapUrls || []);
    processedKeys = new Set(stateCache.processedKeys || []);
    for (const lead of stateCache.leads || []) {
      if (!hasLeadContactData(lead)) continue;
      const key = FDX.leadDedupKey(lead);
      if (key) processedKeys.add(key);
      if (lead.mapsUrl) processedMapUrls.add(FDX.canonicalizeMapsUrl(lead.mapsUrl));
    }
  }

  function mapsUrlsFromLeads(leads) {
    return [
      ...new Set(
        (leads || [])
          .filter(hasLeadContactData)
          .map((lead) => FDX.canonicalizeMapsUrl(lead.mapsUrl))
          .filter(Boolean)
      )
    ];
  }

  function hasLeadContactData(lead) {
    return Boolean(lead && (FDX.normalizePhone(lead.phone) || lead.website));
  }

  function upsertLead(lead) {
    const mapUrl = FDX.canonicalizeMapsUrl(lead.mapsUrl);
    const existingIndex = (stateCache.leads || []).findIndex(
      (existing) => mapUrl && FDX.canonicalizeMapsUrl(existing.mapsUrl) === mapUrl
    );

    if (existingIndex >= 0 && !hasLeadContactData(stateCache.leads[existingIndex])) {
      const nextLeads = [...stateCache.leads];
      nextLeads[existingIndex] = { ...stateCache.leads[existingIndex], ...lead, id: stateCache.leads[existingIndex].id || lead.id };
      stateCache.leads = nextLeads;
      return;
    }

    stateCache.leads = [...(stateCache.leads || []), lead];
  }

  function addLog(level, message, details = {}) {
    FDX.addLog(stateCache, level, message, details);
  }

  async function persistState(force = false) {
    const now = Date.now();
    if (!force && now - lastPersistAt < 900) return;
    lastPersistAt = now;
    stateCache.elapsedMs = currentElapsedMs();
    stateCache.totalFound = foundUrls.size || stateCache.totalFound || 0;
    stateCache.totalExtracted = (stateCache.leads || []).length;
    stateCache.foundMapUrls = [...foundUrls];
    stateCache.processedMapUrls = [...processedMapUrls];
    stateCache.processedKeys = [...processedKeys];
    await FDX.setState(stateCache);
  }

  function currentElapsedMs() {
    if (!stateCache.startedAt) return Number(stateCache.elapsedMs) || 0;
    if ((stateCache.status === "stopped" || stateCache.status === "completed") && stateCache.stoppedAt) {
      return Math.max(0, Number(stateCache.stoppedAt) - Number(stateCache.startedAt));
    }
    if (stateCache.status === "paused" || stateCache.status === "stopped" || stateCache.status === "completed") {
      return Number(stateCache.elapsedMs) || 0;
    }
    return Date.now() - Number(stateCache.startedAt);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  function isMapsPage() {
    return location.hostname.endsWith("google.com") && location.pathname.includes("/maps");
  }

  function detectSearchKeyword() {
    const input =
      document.querySelector('input[aria-label*="Search" i]') ||
      document.querySelector('input[placeholder*="Search" i]');
    if (input && input.value) return FDX.normalizeWhitespace(input.value);

    try {
      const url = decodeURIComponent(location.href);
      const placeMatch = url.match(/\/maps\/search\/([^/@?]+)/i);
      if (placeMatch) return FDX.normalizeWhitespace(placeMatch[1].replace(/\+/g, " "));
      const query = new URL(location.href).searchParams.get("q");
      return FDX.normalizeWhitespace(query || "");
    } catch (_error) {
      return "";
    }
  }

  globalThis.FDSmartMapsExtractorDebug = {
    extractCurrentProfile,
    extractProfileLeadWithScroll,
    extractPhone,
    extractWebsite,
    extractAddress,
    extractRating,
    extractReviews,
    extractCategory,
    extractOpeningHours,
    profileRoot,
    getProfileName,
    unwrapGoogleRedirectUrl,
    extractWebsiteFromBundle,
    extractPhoneFromBundle,
    findProfileScrollContainer,
    extractListingCardDetails
  };
})();
