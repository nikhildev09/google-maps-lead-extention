/* Popup controller for live stats, commands, row selection, and exports. */
(function initPopup() {
  "use strict";

  const FDX = globalThis.FDExtractor;
  const FDExcel = globalThis.FDExcel;
  const rowsLimit = 150;

  let currentState = FDX.createEmptyState();
  let visibleLeadIds = [];
  let messageTimer = null;

  const els = {};

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    cacheElements();
    bindEvents();
    currentState = await FDX.getState();
    render(currentState);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[FDX.STORAGE_KEY]) return;
      currentState = FDX.normalizeState(changes[FDX.STORAGE_KEY].newValue);
      render(currentState);
    });

    window.setInterval(() => renderTimer(currentState), 1000);
  }

  function cacheElements() {
    [
      "statusPill",
      "startBtn",
      "pauseBtn",
      "resumeBtn",
      "stopBtn",
      "clearBtn",
      "logsBtn",
      "excelBtn",
      "csvBtn",
      "websiteScanToggle",
      "selectedOnlyToggle",
      "filterNoWebsiteToggle",
      "foundCount",
      "extractedCount",
      "failedCount",
      "timerValue",
      "currentBusiness",
      "statusText",
      "progressBar",
      "tableCount",
      "selectAllVisible",
      "leadRows",
      "uiMessage"
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.startBtn.addEventListener("click", startExtraction);
    els.pauseBtn.addEventListener("click", () => sendCommand("PAUSE_EXTRACTION", "Pause requested"));
    els.resumeBtn.addEventListener("click", () => sendCommand("RESUME_EXTRACTION", "Resume requested"));
    els.stopBtn.addEventListener("click", () => sendCommand("STOP_EXTRACTION", "Stop requested"));
    els.clearBtn.addEventListener("click", clearData);
    els.logsBtn.addEventListener("click", downloadLogs);
    els.excelBtn.addEventListener("click", exportExcel);
    els.csvBtn.addEventListener("click", exportCsv);

    els.websiteScanToggle.addEventListener("change", saveSettingsFromUi);
    els.selectedOnlyToggle.addEventListener("change", saveSettingsFromUi);
    els.filterNoWebsiteToggle.addEventListener("change", saveSettingsFromUi);

    els.selectAllVisible.addEventListener("change", toggleVisibleSelection);
    els.leadRows.addEventListener("change", handleRowSelection);
  }

  async function startExtraction() {
    setMessage("Preparing extraction...");
    const settings = readSettingsFromUi();

    if (settings.websiteScan) {
      const granted = await requestWebsiteScanPermission();
      if (!granted) {
        settings.websiteScan = false;
        els.websiteScanToggle.checked = false;
        setMessage("Website email scan disabled. Maps extraction will continue.");
      }
    }

    await FDX.updateState((state) => ({
      ...state,
      settings: { ...state.settings, ...settings }
    }));

    const response = await sendBackground({
      type: "START_EXTRACTION",
      payload: {
        settings,
        keyword: currentState.keyword || ""
      }
    });

    if (response.ok) {
      setMessage("Extraction started on Google Maps.");
    } else {
      setMessage(response.error || "Could not start extraction.");
    }
  }

  async function sendCommand(type, successMessage) {
    const response = await sendBackground({ type });
    setMessage(response.ok ? successMessage : response.error || "Command failed.");
  }

  async function clearData() {
    if (!confirm("Clear all extracted leads, logs, and progress?")) return;
    const response = await sendBackground({ type: "CLEAR_DATA" });
    setMessage(response.ok ? "Data cleared." : response.error || "Clear failed.");
  }

  async function downloadLogs() {
    const response = await sendBackground({ type: "DOWNLOAD_LOGS" });
    setMessage(response.ok ? "Log download created." : response.error || "Log download failed.");
  }

  async function exportExcel() {
    try {
      const result = await FDExcel.exportXLSX(currentState.leads, exportOptions());
      setMessage(
        result.usedSheetJS
          ? `Excel export created with ${result.rows} rows.`
          : `Excel-compatible export created with ${result.rows} rows. Add SheetJS for native XLSX.`
      );
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    }
  }

  async function exportCsv() {
    try {
      const result = await FDExcel.exportCSV(currentState.leads, exportOptions());
      setMessage(`CSV export created with ${result.rows} rows.`);
    } catch (error) {
      setMessage(error.message || "CSV export failed.");
    }
  }

  function exportOptions() {
    return {
      selectedOnly: els.selectedOnlyToggle.checked,
      selectedIds: currentState.selectedIds || [],
      filterNoWebsite: els.filterNoWebsiteToggle.checked
    };
  }

  async function saveSettingsFromUi() {
    const settings = readSettingsFromUi();
    currentState = await FDX.updateState((state) => ({
      ...state,
      settings: { ...state.settings, ...settings }
    }));
    render(currentState);
  }

  function readSettingsFromUi() {
    return {
      websiteScan: els.websiteScanToggle.checked,
      selectedOnlyExport: els.selectedOnlyToggle.checked,
      filterNoWebsite: els.filterNoWebsiteToggle.checked
    };
  }

  async function toggleVisibleSelection() {
    const selected = new Set(currentState.selectedIds || []);
    if (els.selectAllVisible.checked) {
      visibleLeadIds.forEach((id) => selected.add(id));
    } else {
      visibleLeadIds.forEach((id) => selected.delete(id));
    }
    await setSelectedIds([...selected]);
  }

  async function handleRowSelection(event) {
    const input = event.target;
    if (!input.matches('input[data-lead-id]')) return;
    const selected = new Set(currentState.selectedIds || []);
    if (input.checked) selected.add(input.dataset.leadId);
    else selected.delete(input.dataset.leadId);
    await setSelectedIds([...selected]);
  }

  async function setSelectedIds(selectedIds) {
    currentState = await FDX.updateState((state) => ({ ...state, selectedIds }));
    render(currentState);
  }

  function render(state) {
    currentState = FDX.normalizeState(state);
    const status = currentState.status || "idle";
    const isRunning = status === "running";
    const isPaused = status === "paused";
    const hasLeads = (currentState.leads || []).length > 0;

    els.statusPill.textContent = status;
    els.statusPill.className = `status-pill ${status}`;
    els.foundCount.textContent = currentState.totalFound || 0;
    els.extractedCount.textContent = currentState.totalExtracted || 0;
    els.failedCount.textContent = currentState.failedCount || 0;
    els.currentBusiness.textContent = currentState.currentBusiness || "-";
    els.statusText.textContent = currentState.statusText || "Ready";

    els.startBtn.disabled = isRunning || isPaused;
    els.pauseBtn.disabled = !isRunning;
    els.resumeBtn.disabled = !isPaused;
    els.stopBtn.disabled = !isRunning && !isPaused;
    els.clearBtn.disabled = isRunning || isPaused;
    els.excelBtn.disabled = !hasLeads;
    els.csvBtn.disabled = !hasLeads;
    els.logsBtn.disabled = !(currentState.logs || []).length;

    els.websiteScanToggle.checked = Boolean(currentState.settings.websiteScan);
    els.selectedOnlyToggle.checked = Boolean(currentState.settings.selectedOnlyExport);
    els.filterNoWebsiteToggle.checked = Boolean(currentState.settings.filterNoWebsite);

    renderTimer(currentState);
    renderProgress(currentState);
    renderRows(currentState);
  }

  function renderTimer(state) {
    const status = state.status || "idle";
    const elapsed =
      status === "running" && state.startedAt
        ? Date.now() - Number(state.startedAt)
        : Number(state.elapsedMs) || 0;
    els.timerValue.textContent = FDX.formatDuration(elapsed);
  }

  function renderProgress(state) {
    const processed = (Number(state.totalExtracted) || 0) + (Number(state.failedCount) || 0);
    const total = Math.max(Number(state.totalFound) || 0, processed);
    const width = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    els.progressBar.style.width = `${width}%`;
  }

  function renderRows(state) {
    const selected = new Set(state.selectedIds || []);
    const filtered = (state.leads || []).filter((lead) => !state.settings.filterNoWebsite || !lead.website);
    const visible = filtered.slice(-rowsLimit).reverse();
    visibleLeadIds = visible.map((lead) => lead.id).filter(Boolean);

    els.tableCount.textContent =
      filtered.length === 1 ? "1 business" : `${filtered.length} businesses`;

    if (!visible.length) {
      els.leadRows.innerHTML = '<tr><td colspan="5" class="empty-state">No leads extracted yet.</td></tr>';
      els.selectAllVisible.checked = false;
      els.selectAllVisible.disabled = true;
      return;
    }

    els.selectAllVisible.disabled = false;
    els.selectAllVisible.checked = visibleLeadIds.length > 0 && visibleLeadIds.every((id) => selected.has(id));
    els.leadRows.innerHTML = visible.map((lead) => rowHtml(lead, selected.has(lead.id))).join("");
  }

  function rowHtml(lead, checked) {
    const statusClass = /fail/i.test(lead.status || "") ? "failed" : "";
    return `
      <tr>
        <td class="select-col">
          <input type="checkbox" data-lead-id="${escapeAttr(lead.id || "")}" ${checked ? "checked" : ""}>
        </td>
        <td><span class="truncate" title="${escapeAttr(lead.businessName || "")}">${escapeHtml(lead.businessName || "-")}</span></td>
        <td><span class="truncate" title="${escapeAttr(lead.phone || "")}">${escapeHtml(lead.phone || "-")}</span></td>
        <td><span class="truncate" title="${escapeAttr(lead.website || "")}">${escapeHtml(hostLabel(lead.website) || "-")}</span></td>
        <td><span class="status-chip ${statusClass}">${escapeHtml(lead.status || "Saved")}</span></td>
      </tr>
    `;
  }

  function hostLabel(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch (_error) {
      return "";
    }
  }

  function requestWebsiteScanPermission() {
    return new Promise((resolve) => {
      if (!chrome.permissions || !chrome.permissions.request) {
        resolve(false);
        return;
      }
      chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }, (granted) => {
        if (chrome.runtime.lastError) resolve(false);
        else resolve(Boolean(granted));
      });
    });
  }

  function sendBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) resolve({ ok: false, error: error.message });
        else resolve(response || { ok: false, error: "No response from extension worker." });
      });
    });
  }

  function setMessage(text) {
    window.clearTimeout(messageTimer);
    els.uiMessage.textContent = text || "";
    if (text) {
      messageTimer = window.setTimeout(() => {
        els.uiMessage.textContent = "";
      }, 5500);
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
