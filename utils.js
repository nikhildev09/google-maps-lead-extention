/* FD Smart Maps Extractor shared helpers.
 * Loaded by the popup, content script, and service worker.
 */
(function initSharedHelpers(global) {
  "use strict";

  const STORAGE_KEY = "fdSmartMapsExtractor.state.v1";
  const CHANNEL = "fd-smart-maps-extractor";
  const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  const DEFAULT_SETTINGS = {
    websiteScan: true,
    maxRetries: 2,
    randomDelayMinMs: 2000,
    randomDelayMaxMs: 5000,
    scrollStepMin: 520,
    scrollStepMax: 920,
    selectedOnlyExport: false,
    filterNoWebsite: false
  };

  function createEmptyState(overrides = {}) {
    return {
      version: 1,
      channel: CHANNEL,
      status: "idle",
      statusText: "Ready",
      startedAt: null,
      stoppedAt: null,
      elapsedMs: 0,
      keyword: "",
      totalFound: 0,
      totalExtracted: 0,
      failedCount: 0,
      currentBusiness: "",
      leads: [],
      selectedIds: [],
      foundMapUrls: [],
      processedKeys: [],
      processedMapUrls: [],
      failedItems: [],
      logs: [],
      settings: { ...DEFAULT_SETTINGS },
      ...overrides
    };
  }

  function normalizeState(raw) {
    const base = createEmptyState();
    const incoming = raw && typeof raw === "object" ? raw : {};
    return {
      ...base,
      ...incoming,
      leads: Array.isArray(incoming.leads) ? incoming.leads : [],
      selectedIds: Array.isArray(incoming.selectedIds) ? incoming.selectedIds : [],
      foundMapUrls: Array.isArray(incoming.foundMapUrls) ? incoming.foundMapUrls : [],
      processedKeys: Array.isArray(incoming.processedKeys) ? incoming.processedKeys : [],
      processedMapUrls: Array.isArray(incoming.processedMapUrls) ? incoming.processedMapUrls : [],
      failedItems: Array.isArray(incoming.failedItems) ? incoming.failedItems : [],
      logs: Array.isArray(incoming.logs) ? incoming.logs : [],
      settings: { ...DEFAULT_SETTINGS, ...(incoming.settings || {}) }
    };
  }

  function chromeAvailable() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      if (!chromeAvailable()) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (result) => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) reject(error);
        else resolve(result || {});
      });
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      if (!chromeAvailable()) {
        resolve();
        return;
      }
      chrome.storage.local.set(value, () => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async function getState() {
    const result = await storageGet([STORAGE_KEY]);
    return normalizeState(result[STORAGE_KEY]);
  }

  async function setState(state) {
    await storageSet({ [STORAGE_KEY]: normalizeState(state) });
    return state;
  }

  async function updateState(updater) {
    const current = await getState();
    const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
    await setState(next);
    return next;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uniqueId(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomInt(min, max) {
    const safeMin = Math.ceil(Number(min) || 0);
    const safeMax = Math.floor(Number(max) || safeMin);
    return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
  }

  function randomDelay(settings = DEFAULT_SETTINGS) {
    const min = Number(settings.randomDelayMinMs) || DEFAULT_SETTINGS.randomDelayMinMs;
    const max = Number(settings.randomDelayMaxMs) || DEFAULT_SETTINGS.randomDelayMaxMs;
    return sleep(randomInt(min, max));
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizePhone(phone) {
    const cleaned = String(phone || "").replace(/[^\d+]/g, "");
    if (cleaned.replace(/\D/g, "").length < 6) return "";
    return cleaned;
  }

  function safeUrl(url, base) {
    try {
      return new URL(url, base || (global.location && global.location.href) || "https://www.google.com/").href;
    } catch (_error) {
      return "";
    }
  }

  function canonicalizeUrl(url) {
    const href = safeUrl(url);
    if (!href) return "";
    try {
      const parsed = new URL(href);
      parsed.hash = "";
      parsed.searchParams.delete("entry");
      parsed.searchParams.delete("hl");
      parsed.searchParams.delete("authuser");
      parsed.searchParams.sort();
      return parsed.href.replace(/\/$/, "");
    } catch (_error) {
      return href.replace(/[#?].*$/, "").replace(/\/$/, "");
    }
  }

  function canonicalizeMapsUrl(url) {
    const href = canonicalizeUrl(url);
    if (!href) return "";
    try {
      const parsed = new URL(href);
      parsed.hash = "";
      parsed.search = "";
      return parsed.href.replace(/\/$/, "");
    } catch (_error) {
      return href.replace(/[?#].*$/, "").replace(/\/$/, "");
    }
  }

  function extractCoordinates(url) {
    const href = decodeURIComponent(String(url || ""));
    const atMatch = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (atMatch) {
      return { latitude: atMatch[1], longitude: atMatch[2] };
    }
    const dataMatch = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (dataMatch) {
      return { latitude: dataMatch[1], longitude: dataMatch[2] };
    }
    return { latitude: "", longitude: "" };
  }

  function extractEmails(text) {
    const source = String(text || "");
    const matches = source.match(EMAIL_REGEX) || [];
    return [...new Set(matches.map((email) => email.toLowerCase()))];
  }

  function classifySocialUrl(url) {
    const href = safeUrl(url);
    if (!href) return "";
    const lower = href.toLowerCase();
    if (lower.includes("instagram.com")) return "instagram";
    if (lower.includes("facebook.com") || lower.includes("fb.com")) return "facebook";
    if (lower.includes("wa.me") || lower.includes("whatsapp.com")) return "whatsapp";
    if (lower.includes("linkedin.com")) return "linkedin";
    return "";
  }

  function mergeSocialLinks(target, urls) {
    const next = { ...(target || {}) };
    (urls || []).forEach((url) => {
      const type = classifySocialUrl(url);
      if (type && !next[type]) next[type] = safeUrl(url);
    });
    return next;
  }

  function leadDedupKey(lead) {
    const phone = normalizePhone(lead && lead.phone);
    if (phone) return `phone:${phone}`;
    const mapsUrl = canonicalizeMapsUrl(lead && lead.mapsUrl);
    if (mapsUrl) return `maps:${mapsUrl}`;
    return "";
  }

  function scoreLead(lead) {
    let score = 10;
    if (lead.phone) score += 25;
    if (lead.website) score += 20;
    if (lead.email) score += 20;
    if (lead.instagram || lead.facebook || lead.whatsapp || lead.linkedin) score += 10;
    if (lead.rating && Number.parseFloat(lead.rating) >= 4) score += 8;
    if (lead.reviews && Number.parseInt(String(lead.reviews).replace(/\D/g, ""), 10) >= 50) score += 7;
    return Math.min(score, 100);
  }

  function logEntry(level, message, details = {}) {
    return {
      id: uniqueId("log"),
      at: nowIso(),
      level,
      message,
      details
    };
  }

  function addLog(state, level, message, details = {}) {
    const logs = [...(state.logs || []), logEntry(level, message, details)];
    state.logs = logs.slice(-500);
    return state;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  global.FDExtractor = {
    STORAGE_KEY,
    CHANNEL,
    DEFAULT_SETTINGS,
    EMAIL_REGEX,
    createEmptyState,
    normalizeState,
    storageGet,
    storageSet,
    getState,
    setState,
    updateState,
    nowIso,
    uniqueId,
    sleep,
    randomInt,
    randomDelay,
    normalizeWhitespace,
    normalizePhone,
    safeUrl,
    canonicalizeUrl,
    canonicalizeMapsUrl,
    extractCoordinates,
    extractEmails,
    classifySocialUrl,
    mergeSocialLinks,
    leadDedupKey,
    scoreLead,
    logEntry,
    addLog,
    formatDuration
  };
})(globalThis);
