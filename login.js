// linear_login.js
const fs = require("fs-extra");
const path = require("path");
const { chromium } = require("playwright");

const USERDATA_DIR = path.join(__dirname, "pw-user-data");
const SESSION_FILE = path.join(__dirname, "linear-state.json");

(async () => {
  console.log("🚀 Starting Linear Login Initializer...");
  console.log("📁 User profile:", USERDATA_DIR);

  // persistent chromium
  const ctx = await chromium.launchPersistentContext(USERDATA_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-infobars"
    ]
  });

  const page = await ctx.newPage();

  console.log("🌐 Opening Linear...");
  await page.goto("https://linear.app/", { waitUntil: "domcontentloaded" });

  console.log("👤 Please log in manually.");
  console.log("⏳ This window will stay open until you close the browser.");
  console.log("   After login finishes, close the browser window to save the session.");

  // Wait until the browser closes
  await new Promise((resolve) => ctx.on("close", resolve));

  console.log("💾 Saving session state...");
  await ctx.storageState({ path: SESSION_FILE });

  console.log("✅ Login session saved to:", SESSION_FILE);
})();