/* Export helpers for CSV and XLSX. Uses SheetJS when vendor/xlsx.full.min.js is present. */
(function initExcelHelpers(global) {
  "use strict";

  const COLUMNS = [
    "Business Name",
    "Phone",
    "Website",
    "Address",
    "Rating",
    "Reviews",
    "Category",
    "Hours",
    "Email",
    "Instagram",
    "Facebook",
    "WhatsApp",
    "LinkedIn",
    "Maps URL",
    "Latitude",
    "Longitude",
    "Keyword",
    "Lead Score",
    "WhatsApp Outreach",
    "Status"
  ];

  function rowsFromLeads(leads, options = {}) {
    const selected = new Set(options.selectedIds || []);
    return (leads || [])
      .filter((lead) => !options.selectedOnly || selected.has(lead.id))
      .filter((lead) => !options.filterNoWebsite || !lead.website)
      .map((lead) => ({
        "Business Name": lead.businessName || "",
        Phone: lead.phone || "",
        Website: lead.website || "",
        Address: lead.address || "",
        Rating: lead.rating || "",
        Reviews: lead.reviews || "",
        Category: lead.category || "",
        Hours: lead.openingHours || "",
        Email: lead.email || "",
        Instagram: lead.instagram || "",
        Facebook: lead.facebook || "",
        WhatsApp: lead.whatsapp || "",
        LinkedIn: lead.linkedin || "",
        "Maps URL": lead.mapsUrl || "",
        Latitude: lead.latitude || "",
        Longitude: lead.longitude || "",
        Keyword: lead.keywordTag || "",
        "Lead Score": lead.leadScore || "",
        "WhatsApp Outreach": lead.whatsappOutreach || "",
        Status: lead.status || ""
      }));
  }

  async function exportXLSX(leads, options = {}) {
    const rows = rowsFromLeads(leads, options);
    const filename = datedFilename("fd-smart-maps-leads", global.XLSX ? "xlsx" : "xls");

    if (global.XLSX) {
      const worksheet = global.XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
      worksheet["!cols"] = COLUMNS.map((column) => ({ wch: Math.max(14, Math.min(42, column.length + 6)) }));
      const workbook = global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
      const output = global.XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      await downloadBlob(
        new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        filename
      );
      return { rows: rows.length, filename, usedSheetJS: true };
    }

    // Last-resort fallback keeps the button useful if SheetJS is not present.
    const html = tableHtml(rows);
    await downloadBlob(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }), filename);
    return { rows: rows.length, filename, usedSheetJS: false };
  }

  async function exportCSV(leads, options = {}) {
    const rows = rowsFromLeads(leads, options);
    const csv = toCsv(rows);
    const filename = datedFilename("fd-smart-maps-leads", "csv");
    await downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), filename);
    return { rows: rows.length, filename };
  }

  function toCsv(rows) {
    const lines = [COLUMNS.map(csvEscape).join(",")];
    for (const row of rows) {
      lines.push(COLUMNS.map((column) => csvEscape(row[column])).join(","));
    }
    return lines.join("\r\n");
  }

  function csvEscape(value) {
    const text = String(value == null ? "" : value);
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function tableHtml(rows) {
    const header = COLUMNS.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
    const body = rows
      .map((row) => `<tr>${COLUMNS.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`)
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function datedFilename(prefix, extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${prefix}-${stamp}.${extension}`;
  }

  function downloadBlob(blob, filename) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
        const error = chrome.runtime.lastError;
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        if (error) reject(error);
        else resolve(downloadId);
      });
    });
  }

  global.FDExcel = {
    COLUMNS,
    rowsFromLeads,
    exportXLSX,
    exportCSV
  };
})(globalThis);
