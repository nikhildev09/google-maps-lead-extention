# 🚀 Google Maps Lead Extension

### ⚡ Find Leads. Extract Data. Save Time.

**Google Maps Lead Extension** is a Chrome/Chromium browser extension that helps automate lead generation from Google Maps.

Instead of manually opening every business profile and copying contact information, the extension can process Google Maps business listings **one by one**, collect available business details, and organize the information into a structured file.

> 💡 Built for digital marketers, agencies, sales teams, freelancers, entrepreneurs, and businesses that need a faster way to research potential customers.

---

## ✨ Features

| Feature                 | Description                                  |
| ----------------------- | -------------------------------------------- |
| 🔍 Google Maps Search   | Search for businesses using Google Maps      |
| 🤖 Automated Processing | Open business profiles one by one            |
| 📇 Lead Extraction      | Collect available business information       |
| 📞 Contact Details      | Extract available phone numbers and websites |
| 📍 Business Information | Collect name, category, address, etc.        |
| 🔗 Google Maps URL      | Save the business profile URL                |
| 📊 Structured Data      | Organize leads into a clean format           |
| 💾 Export               | Save collected leads for further use         |
| ⚡ Fast Workflow         | Reduce repetitive manual work                |

---

# 🧠 How It Works

The extension works by interacting with the Google Maps webpage and processing business listings sequentially.

### 🔄 Workflow

```text
┌──────────────────────┐
│    Open Google Maps  │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Search for a Business│
│      Category        │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Find Business Listings│
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Open Profile #1       │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Extract Available     │
│ Business Information  │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Save Lead             │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Open Next Profile     │
└──────────┬───────────┘
           ↓
        Repeat 🔁
           ↓
┌──────────────────────┐
│ Export Lead Data      │
└──────────────────────┘
```

---

# 📦 Installation

You don't need to publish the extension on the Chrome Web Store.

You can install it locally using **Chrome's Developer Mode**.

## 1️⃣ Download the Repository

Clone the repository:

```bash
git clone https://github.com/YOUR-USERNAME/google-maps-lead-extention.git
```

Or download the repository as a ZIP file:

```text
GitHub
  ↓
Code
  ↓
Download ZIP
  ↓
Extract the ZIP
```

---

# 🌐 Install on Google Chrome

### Step 1 — Open Extensions

Open Chrome and visit:

```text
chrome://extensions/
```

### Step 2 — Enable Developer Mode

Turn on:

```text
Developer mode
```

You can find the toggle in the **top-right corner**.

### Step 3 — Load the Extension

Click:

```text
Load unpacked
```

Select the project folder containing:

```text
manifest.json
```

For example:

```text
google-maps-lead-extention/
│
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
└── ...
```

### Step 4 — Done 🎉

The extension should now appear in your Chrome extensions list.

You can click the **Extensions 🧩** button in Chrome and pin the extension for easy access.

---

# 🌐 Using Other Browsers

Because the project is built as a browser extension, it may also work with other **Chromium-based browsers**, depending on their extension compatibility.

Examples include:

* 🌐 Google Chrome
* 🟦 Microsoft Edge
* 🟠 Brave
* 🟢 Opera
* Other Chromium-based browsers

The installation process is generally similar:

```text
Browser Settings
      ↓
Extensions
      ↓
Developer Mode
      ↓
Load Unpacked
      ↓
Select Project Folder
```

> ⚠️ Browser compatibility may vary depending on the browser and the extension APIs used by the project.

---

# 🎯 How To Use

## Step 1 — Open Google Maps

Go to:

```text
https://www.google.com/maps
```

---

## Step 2 — Search for a Business Category

For example:

```text
digital marketing agencies in Delhi
```

or:

```text
dentists in Mumbai
```

or:

```text
restaurants in Bangalore
```

You can search for the type of businesses that you want to research.

---

## Step 3 — Open the Extension

Click the extension icon from your browser toolbar.

You should see the extension interface.

---

## Step 4 — Start Lead Collection

Start the lead extraction process using the controls provided by the extension.

The extension will process available Google Maps business listings sequentially.

```text
Business #1
    ↓
Extract Information
    ↓
Save Lead
    ↓
Business #2
    ↓
Extract Information
    ↓
Save Lead
    ↓
Business #3
    ↓
...
```

---

# 📊 Example Lead Data

The collected information can be organized like this:

```text
Business Name       : ABC Digital Marketing
Category            : Marketing Agency
Phone               : +91 XXXXX XXXXX
Website             : https://example.com
Address             : New Delhi, India
Google Maps URL     : https://maps.google.com/...
```

Depending on what Google Maps makes publicly available for a particular business, some fields may be empty.

---

# 💻 Example Data Structure

A lead can be represented in JavaScript like this:

```javascript
const lead = {
    name: "ABC Digital Marketing",
    category: "Digital Marketing Agency",
    phone: "+91 XXXXX XXXXX",
    website: "https://example.com",
    address: "New Delhi, India",
    mapsUrl: "https://maps.google.com/..."
};

console.log(lead);
```

Multiple leads can then be stored in an array:

```javascript
const leads = [
    {
        name: "ABC Digital Marketing",
        phone: "+91 XXXXX XXXXX",
        website: "https://example.com"
    },
    {
        name: "XYZ Media",
        phone: "+91 XXXXX XXXXX",
        website: "https://example.com"
    }
];

console.log(leads);
```

---

# 📁 Project Structure

The project may look like:

```text
google-maps-lead-extention/
│
├── 📄 manifest.json
│
├── 📄 background.js
│
├── 📄 content.js
│
├── 📄 popup.html
├── 📄 popup.js
├── 📄 popup.css
│
├── 📁 icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── 📄 README.md
```

> The exact files may vary depending on the current version of the project.

---

# ⚙️ Extension Architecture

The extension generally consists of several important components:

### 🧩 `manifest.json`

The manifest defines the extension configuration, permissions, scripts, and other browser settings.

Example:

```json
{
    "manifest_version": 3,
    "name": "Google Maps Lead Extension",
    "version": "1.0.0",
    "description": "Extract business information from Google Maps.",
    "action": {
        "default_popup": "popup.html"
    }
}
```

---

### 🖥️ Popup

The popup provides the user interface for controlling the extension.

Example:

```html
<button id="start">Start Lead Extraction</button>
<button id="stop">Stop</button>
```

---

### ⚙️ JavaScript

JavaScript handles the extension's functionality and communication with the webpage.

Example:

```javascript
document.getElementById("start").addEventListener("click", () => {
    console.log("Lead extraction started...");
});
```

---

# 🔐 Permissions

Browser extensions may require permissions to interact with websites.

For example:

```json
{
    "permissions": [
        "activeTab",
        "storage"
    ]
}
```

Only request permissions that are actually required by the extension.

---

# 📤 Exporting Leads

The collected data can be saved in a structured format such as CSV.

Example:

```csv
Business Name,Phone,Website,Address
ABC Digital Marketing,+91 XXXXX XXXXX,https://example.com,New Delhi
XYZ Media,+91 XXXXX XXXXX,https://example.com,Mumbai
```

This makes the data easy to open in:

* Microsoft Excel
* Google Sheets
* LibreOffice
* CRM systems
* Data-analysis tools

---

# 🛠️ Development

Want to modify the extension?

Clone the repository:

```bash
git clone https://github.com/YOUR-USERNAME/google-maps-lead-extention.git
cd google-maps-lead-extention
```

Make your changes and reload the extension from:

```text
chrome://extensions/
```

Then click:

```text
Reload ↻
```

on the extension card.

---

# 🔄 Updating the Extension

After making changes:

```text
1. Edit the code
       ↓
2. Save the files
       ↓
3. Open chrome://extensions/
       ↓
4. Find the extension
       ↓
5. Click Reload ↻
       ↓
6. Test again
```

---

# 🚀 Use Cases

### 📈 Digital Marketing Agencies

Find businesses that may need:

* Website development
* SEO
* Social media management
* Google Ads
* Meta Ads
* Marketing automation

### 🤝 Sales Teams

Build prospect lists and research potential customers.

### 👨‍💻 Freelancers

Find potential clients in specific industries or locations.

### 🏢 Businesses

Research local businesses and competitors.

### 📊 Market Research

Collect publicly available business information for research and analysis.

---

# ⚠️ Important Disclaimer

This project is intended for **educational, research, and legitimate business lead-generation purposes**.

Users are responsible for complying with:

* Google Maps / Google terms and policies
* Applicable privacy laws
* Data protection regulations
* Local laws and regulations
* Any applicable website usage restrictions

Do not use the extension for spam, harassment, unauthorized scraping, or unlawful collection or use of personal information.

Always use collected information responsibly and respect opt-out or do-not-contact requests.

---

# ⭐ Support the Project

If you find this project useful:

⭐ **Star the repository**

🍴 **Fork the repository**

🐛 **Report bugs**

💡 **Suggest improvements**

🔧 **Submit pull requests**

---

# 🤝 Contributing

Contributions are welcome!

```bash
# Fork the repository

# Clone your fork
git clone https://github.com/YOUR-USERNAME/google-maps-lead-extention.git

# Create a new branch
git checkout -b feature/new-feature

# Make your changes

# Commit
git add .
git commit -m "Add new feature"

# Push
git push origin feature/new-feature
```

Then open a Pull Request on GitHub.

---

# 📜 License

This project is open-source. See the `LICENSE` file for the terms under which this project can be used and modified.

---

# 👨‍💻 Author

**Nikhil**

Built with ❤️ for faster and smarter lead generation.

---

## ⭐ If this project helped you, consider giving it a star!

```text
        ⭐ Star this repository ⭐
                 ↓
       Google Maps Lead Extension
                 ↓
          Find • Extract • Grow
```
