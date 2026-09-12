/* Service worker for command routing, optional website enrichment, and downloads. */
importScripts("utils.js");

const FDX = globalThis.FDExtractor;

chrome.runtime.onInstalled.addListener(async () => {
  const state = await FDX.getState();
  if (!state || state.channel !== FDX.CHANNEL) {
    await FDX.setState(FDX.createEmptyState());
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("FD Smart Maps Extractor background error:", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  if (!message || !message.type) return { ok: false, error: "Unknown message" };

  switch (message.type) {
    case "GET_STATE":
      return { ok: true, state: await FDX.getState() };

    case "START_EXTRACTION":
      return sendCommandToMapsTab("FD_START_EXTRACTION", message.payload || {});

    case "PAUSE_EXTRACTION":
      return sendCommandToMapsTab("FD_PAUSE_EXTRACTION", {});

    case "RESUME_EXTRACTION":
      return sendCommandToMapsTab("FD_RESUME_EXTRACTION", {});

    case "STOP_EXTRACTION":
      return sendCommandToMapsTab("FD_STOP_EXTRACTION", {});

    case "CLEAR_DATA":
      await FDX.setState(FDX.createEmptyState({ statusText: "Data cleared" }));
      await notifyKnownMapsTabs("FD_STOP_EXTRACTION", { silent: true });
      return { ok: true };

    case "SCRAPE_WEBSITE":
      return {
        ok: true,
        enrichment: await scrapeWebsite(message.url, message.options || {}),
        sourceTabId: sender && sender.tab && sender.tab.id
      };

    case "DOWNLOAD_LOGS":
      return downloadLogs();

    default:
      return { ok: false, error: `Unsupported message type: ${message.type}` };
  }
}

async function sendCommandToMapsTab(type, payload) {
  const tab = await getActiveMapsTab();
  if (!tab) {
    return { ok: false, error: "Open https://www.google.com/maps and run a search first." };
  }

  await ensureContentScript(tab.id);
  const response = await sendTabMessage(tab.id, { type, payload });
  return { ok: true, tabId: tab.id, response };
}

async function getActiveMapsTab() {
  const tabs = await chromeQueryTabs({ active: true, currentWindow: true });
  const active = tabs.find((tab) => isGoogleMapsUrl(tab.url));
  if (active) return active;

  const mapsTabs = await chromeQueryTabs({ url: ["https://www.google.com/maps*", "https://*.google.com/maps*"] });
  return mapsTabs.find((tab) => isGoogleMapsUrl(tab.url)) || null;
}

function isGoogleMapsUrl(url) {
  try {
    const parsed = new URL(url || "");
    return parsed.hostname.endsWith("google.com") && parsed.pathname.includes("/maps");
  } catch (_error) {
    return false;
  }
}

function chromeQueryTabs(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || [])));
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    await sendTabMessage(tabId, { type: "FD_PING" });
    return;
  } catch (_error) {
    // The declarative content script can miss already-open tabs after install.
  }

  await chromeExecuteScript({ target: { tabId }, files: ["utils.js", "content.js"] });
  await FDX.sleep(250);
}

function chromeExecuteScript(details) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(details, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else resolve(result || []);
    });
  });
}

async function notifyKnownMapsTabs(type, payload) {
  const tabs = await chromeQueryTabs({ url: ["https://www.google.com/maps*", "https://*.google.com/maps*"] });
  await Promise.allSettled(
    tabs.filter((tab) => isGoogleMapsUrl(tab.url)).map((tab) => sendTabMessage(tab.id, { type, payload }))
  );
}

async function scrapeWebsite(rawUrl, options = {}) {
  const url = normalizeWebsiteUrl(rawUrl);
  const empty = {
    url,
    emails: [],
    socialLinks: {},
    contactPagesVisited: [],
    permissionGranted: false,
    error: ""
  };

  if (!url) return { ...empty, error: "Invalid website URL" };
  const permissionGranted = await hasWebsiteHostPermission(url);
  if (!permissionGranted) {
    return {
      ...empty,
      permissionGranted: false,
      error: "Website scanning permission was not granted"
    };
  }

  let tabId = null;
  const emailSet = new Set();
  const socialLinks = {};
  const contactPagesVisited = [];
  const timeoutMs = Math.min(Number(options.timeoutMs) || 15000, 25000);
  const maxContactPages = Math.min(Number(options.maxContactPages) || 2, 3);

  try {
    const tab = await chromeCreateTab({ url, active: false });
    tabId = tab.id;
    await waitForTabComplete(tabId, timeoutMs);

    const firstPage = await scrapeVisiblePage(tabId);
    collectEnrichment(firstPage, emailSet, socialLinks);

    const contactLinks = (firstPage.contactLinks || [])
      .map((link) => normalizeWebsiteUrl(link))
      .filter((link) => link && sameSite(url, link))
      .slice(0, maxContactPages);

    for (const contactUrl of contactLinks) {
      contactPagesVisited.push(contactUrl);
      await chromeUpdateTab(tabId, { url: contactUrl });
      await waitForTabComplete(tabId, timeoutMs);
      const contactPage = await scrapeVisiblePage(tabId);
      collectEnrichment(contactPage, emailSet, socialLinks);
      await FDX.sleep(FDX.randomInt(800, 1700));
    }

    return {
      url,
      emails: [...emailSet].slice(0, 12),
      socialLinks,
      contactPagesVisited,
      permissionGranted: true,
      error: ""
    };
  } catch (error) {
    return {
      ...empty,
      permissionGranted: true,
      emails: [...emailSet],
      socialLinks,
      contactPagesVisited,
      error: error.message || String(error)
    };
  } finally {
    if (tabId) {
      chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
    }
  }
}

function normalizeWebsiteUrl(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) return "";
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(withScheme);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    return parsed.href;
  } catch (_error) {
    return "";
  }
}

async function hasWebsiteHostPermission(url) {
  try {
    const parsed = new URL(url);
    const originPattern = `${parsed.origin}/*`;
    const broadPattern = `${parsed.protocol}//*/*`;
    return (
      (await permissionsContains({ origins: [originPattern] })) ||
      (await permissionsContains({ origins: [broadPattern] })) ||
      (await permissionsContains({ origins: ["http://*/*", "https://*/*"] }))
    );
  } catch (_error) {
    return false;
  }
}

function permissionsContains(permission) {
  return new Promise((resolve) => {
    chrome.permissions.contains(permission, (hasPermission) => resolve(Boolean(hasPermission)));
  });
}

function chromeCreateTab(details) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(details, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else resolve(tab);
    });
  });
}

function chromeUpdateTab(tabId, details) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, details, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else resolve(tab);
    });
  });
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) finish();
      else if (tab.status === "complete") finish();
    });
  });
}

async function scrapeVisiblePage(tabId) {
  const [result] = await chromeExecuteScript({
    target: { tabId },
    func: scrapeVisiblePageInTab,
    args: [FDX.EMAIL_REGEX.source]
  });
  return (result && result.result) || { emails: [], socialUrls: [], contactLinks: [] };
}

function scrapeVisiblePageInTab(emailRegexSource) {
  const emailRegex = new RegExp(emailRegexSource, "g");
  const text = document.body ? document.body.innerText || "" : "";
  const emails = [...new Set((text.match(emailRegex) || []).map((email) => email.toLowerCase()))];
  const anchors = Array.from(document.links || []).map((anchor) => ({
    href: anchor.href,
    text: `${anchor.innerText || ""} ${anchor.getAttribute("aria-label") || ""}`.trim()
  }));

  const socialUrls = anchors
    .map((anchor) => anchor.href)
    .filter((href) => /instagram\.com|facebook\.com|fb\.com|wa\.me|whatsapp\.com|linkedin\.com/i.test(href));

  const contactLinks = anchors
    .filter((anchor) => /contact|enquiry|enquire|reach|about|support|connect/i.test(`${anchor.text} ${anchor.href}`))
    .map((anchor) => anchor.href)
    .filter((href) => /^https?:\/\//i.test(href));

  return {
    url: location.href,
    title: document.title || "",
    emails,
    socialUrls: [...new Set(socialUrls)].slice(0, 12),
    contactLinks: [...new Set(contactLinks)].slice(0, 6)
  };
}

function collectEnrichment(page, emailSet, socialLinks) {
  (page.emails || []).forEach((email) => emailSet.add(email));
  const merged = FDX.mergeSocialLinks(socialLinks, page.socialUrls || []);
  Object.assign(socialLinks, merged);
}

function sameSite(a, b) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.hostname.replace(/^www\./i, "") === right.hostname.replace(/^www\./i, "");
  } catch (_error) {
    return false;
  }
}

async function downloadLogs() {
  const state = await FDX.getState();
  const payload = {
    generatedAt: FDX.nowIso(),
    status: state.status,
    totalFound: state.totalFound,
    totalExtracted: state.totalExtracted,
    failedCount: state.failedCount,
    logs: state.logs || [],
    failedItems: state.failedItems || []
  };
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
  const filename = `fd-smart-maps-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const downloadId = await chromeDownload({ url: dataUrl, filename, saveAs: true });
  return { ok: true, downloadId };
}

function chromeDownload(details) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(details, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else resolve(downloadId);
    });
  });
}
