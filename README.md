# FD Smart Maps Extractor

Production-ready Chrome Extension MV3 source for extracting business lead data from Google Maps search result pages.

The extension is designed for educational and business lead-generation workflows where the user manually performs a Google Maps search, then starts extraction from the popup. It uses paced scrolling, live progress updates, duplicate removal, persistent local storage, retry handling, logs, CSV export, and XLSX export through a local SheetJS bundle.

## Features

- Google Maps-only content script injection
- Live popup progress: found, extracted, failed, current business, status, and timer
- Continuous Google Maps sidebar scrolling with randomized 2-5 second waits
- Profile opening, detail extraction, retry handling, and duplicate removal
- `chrome.storage.local` persistence for leads, logs, state, selected rows, and pause/resume state
- Pause, resume, stop, clear data, and auto resume after tab reload
- XLSX export with SheetJS and CSV export
- Optional website email/social scan through user-granted optional host permissions
- Downloadable JSON logs
- Keyword tagging, lead scoring, selected-row export, no-website filtering, and WhatsApp outreach links

## Extracted Fields

- Business Name
- Phone Number
- Website
- Address
- Rating
- Total Reviews
- Business Category
- Opening Hours
- Google Maps URL
- Latitude
- Longitude
- Email
- Facebook
- Instagram
- WhatsApp
- LinkedIn
- Keyword Tag
- Lead Score
- WhatsApp Outreach URL

## Project Structure

```text
.
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── popup.css
├── utils.js
├── excel.js
├── vendor/
│   └── xlsx.full.min.js
├── icons/
│   ├── icon.svg
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── screenshots/
    ├── popup-preview.svg
    └── workflow-preview.svg
```

## Example Screenshots

![Popup preview](screenshots/popup-preview.svg)

![Workflow preview](screenshots/workflow-preview.svg)

## Install in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

```text
C:\Users\aspdi\OneDrive\Desktop\extentions\google map data extactor
```

5. Open `https://www.google.com/maps`.
6. Search a query such as `gyms in delhi`.
7. Open the extension popup and click `Start Extraction`.

## Website Email Scan Permission

Google Maps host permissions are declared by default. Scanning business websites for visible email addresses requires broader site access, so the extension requests optional `http://*/*` and `https://*/*` permission only when `Email scan websites` is enabled and the user clicks Start.

If permission is denied, Google Maps extraction continues and website email scanning is skipped.

## Debugging

Use these Chrome pages while developing:

- `chrome://extensions` -> extension card -> `service worker` to inspect `background.js`
- Google Maps tab -> DevTools -> Console to inspect `content.js`
- Right-click popup -> Inspect to inspect `popup.js`, export, and UI state

Useful checks:

- Confirm the active tab URL starts with `https://www.google.com/maps`
- Check `chrome.storage.local` in DevTools Application tab
- Use `Download Logs` in the popup for extraction errors and failed profiles
- If Google Maps changes markup, inspect for `role="feed"`, `/maps/place/` links, and accessible labels

## Package Extension

From the parent folder, create a ZIP package:

```powershell
Compress-Archive -Path "google map data extactor\*" -DestinationPath "fd-smart-maps-extractor.zip" -Force
```

Upload the ZIP to the Chrome Web Store developer dashboard or keep it for internal distribution.

## Notes

- The extractor avoids fixed aggressive timing and uses randomized waits to reduce load on pages.
- It does not bypass paywalls, logins, captchas, or technical access controls.
- Google Maps DOM changes over time; selectors use ARIA, roles, semantic attributes, and XPath fallbacks, but future Maps UI changes may still require selector updates.
- Respect applicable laws, website terms, robots instructions, and privacy obligations when collecting or contacting leads.
