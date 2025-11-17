const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'linear-state.json');
const USERDATA_DIR = path.join(__dirname, 'pw-user-data');
const OUT_DIR = path.join(__dirname, 'captures');
fs.ensureDirSync(OUT_DIR);

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function saveSnapshot(page, name) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const p = path.join(OUT_DIR, `${ts}_${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`📸 Snapshot: ${p}`);
}

async function elementExists(page, locator) {
  const el = await page.$(locator);
  return !!(el && await el.isVisible());
}

class LinearAgent {
  constructor(goal) {
    this.goal = goal.toLowerCase();
    this.projectName = this.extractProjectName();
  }

  extractProjectName() {
    const m = this.goal.match(/project (?:called|named)?\s*([a-zA-Z0-9_\-]+)/);
    return m ? m[1] : `Auto_${Date.now().toString().slice(-4)}`;
  }

  async init() {
    console.log(`🧠 Goal: "${this.goal}"`);
    console.log(`💡 Parsed intent: create project named "${this.projectName}"`);
    this.ctx = await chromium.launchPersistentContext(USERDATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });
    this.page = await this.ctx.newPage();
    console.log(fs.existsSync(SESSION_FILE)
      ? '✅ Using saved Linear session...'
      : '⚠️ No saved session, login manually once.');
  }

  async navigate() {
    console.log('🌐 Navigating to https://linear.app/');
    await this.page.goto('https://linear.app/', { waitUntil: 'domcontentloaded' });
    console.log('⏳ Waiting up to 30s for dashboard to load...');
    await wait(8000); // give React initial render time

    let sidebarVisible = false;
    for (let i = 0; i < 10; i++) {
      sidebarVisible = await elementExists(this.page, 'aside, [data-testid*="sidebar"], nav, div:has-text("Projects")');
      if (sidebarVisible) break;
      console.log(`  🔁 Sidebar not ready yet (${i+1}/6)...`);
      await wait(8000);
    }

    if (!sidebarVisible) {
      console.warn('⚠️ Sidebar not detected — dumping visible DOM text for analysis:');
      const textDump = await this.page.evaluate(() =>
        Array.from(document.querySelectorAll('div,nav,aside,section'))
          .map(e => e.textContent.trim())
          .filter(t => t && t.length < 200)
          .slice(0, 25)
      );
      console.log('🧩 Visible snippets:', textDump);
    }

    await saveSnapshot(this.page, 'dashboard_loaded');
  }

  async goToProjects() {
    console.log('🧭 Searching for visible "Projects" link in sidebar...');
    const candidates = [
      'text=Projects',
      'div:has-text("Projects")',
      'a:has-text("Projects")',
      'nav >> text=Projects',
      'aside >> text=Projects'
    ];

    for (const selector of candidates) {
      const handles = await this.page.$$(selector);
      for (const handle of handles) {
        try {
          if (await handle.isVisible()) {
            const text = await handle.textContent();
            console.log(`👉 Attempting click on: "${text?.trim()}" [${selector}]`);
            await handle.scrollIntoViewIfNeeded();
            await wait(800);
            await handle.click({ timeout: 8000, delay: 100 });
            await wait(8000);
            await saveSnapshot(this.page, 'projects_page_after_click');
            console.log('✅ Click succeeded!');
            return true;
          }
        } catch (err) {
          console.warn(`⚠️ Click failed for ${selector}: ${err.message}`);
          await wait(1000);
        }
      }
    }

    console.warn('❌ Could not click any visible "Projects" link.');
    await saveSnapshot(this.page, 'projects_click_failed');
    return false;
  }

  async addProject() {
    console.log('➕ Waiting for Projects page to fully load...');

    // Wait up to 10s for the page to switch after clicking Projects
    let pageReady = false;
    for (let i = 0; i < 30; i++) {
      const hasAddBtn = await elementExists(this.page, 'button:has-text("Add project")');
      const hasHeader = await elementExists(this.page, 'h1:has-text("Projects"), [role="heading"]:has-text("Projects")');
      if (hasAddBtn || hasHeader) {
        pageReady = true;
        console.log(`✅ Projects page detected (after ${i + 1} checks)`);
        break;
      }
      console.log(`  🔁 Waiting for Projects UI (${i + 1}/10)...`);
      await wait(1000);
    }

    if (!pageReady) {
      console.warn('⚠️ Projects page did not fully load, continuing anyway...');
    }

    console.log('➕ Searching for "Add project" button...');
    const addSelectors = [
      'button:has-text("Add project")',
      'text="+ Add project"',
      '[aria-label="Add project"]',
      'button:has-text("Add Project")'
    ];

    for (const sel of addSelectors) {
      try {
        if (await elementExists(this.page, sel)) {
          console.log(`✅ Found Add Project button: ${sel}`);
          const btn = this.page.locator(sel);
          await btn.scrollIntoViewIfNeeded();
          await wait(500);
          await btn.click({ delay: 100 });
          await wait(8000);
          await saveSnapshot(this.page, 'add_project_modal');
          return true;
        }
      } catch (err) {
        console.warn(`⚠️ Click attempt failed on ${sel}: ${err.message}`);
      }
    }

    console.warn('❌ Could not find Add Project button after waiting.');
    await saveSnapshot(this.page, 'add_project_not_found');
    return false;
  }



  async fillProjectName() {
    console.log(`⌨️ Typing "${this.projectName}"...`);
    const sels = ['div.ProseMirror.editor', '[contenteditable="true"]', '[role="textbox"]'];
    for (const s of sels) {
      const el = await this.page.$(s);
      if (el && await el.isVisible()) {
        await el.click();
        await this.page.keyboard.type(this.projectName, { delay: 70 });
        await saveSnapshot(this.page, 'filled_name');
        return true;
      }
    }
    console.warn('❌ Project name field not found.');
    return false;
  }

async createProject() {
  console.log("🕒 Waiting for overlays to clear...");

  // Remove overlay
  await this.page.waitForSelector('.sc-jCttAn', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await this.page.waitForTimeout(500);

  console.log("🔍 Looking for Create project button...");

  // Playwright-friendly selectors
  const selectors = [
    'button:has-text("Create project")',
    'button[type="submit"]:has-text("Create project")',
    '[data-active="false"].sc-cpSJdf'
  ];

  for (const sel of selectors) {
    const exists = await elementExists(this.page, sel);
    if (!exists) continue;

    console.log(`✅ Clicking Create Project via: ${sel}`);

    const locator = this.page.locator(sel);
    await locator.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);

    // Try normal click first
    try {
      await locator.click({ timeout: 5000 });
      await wait(6000);
      await saveSnapshot(this.page, 'created');
      console.log(`🎉 Project "${this.projectName}" created.`);
      return true;
    } catch {
      console.log("⚠️ Normal click blocked. Trying JS DOM click...");
    }

    // JS-safe fallback: extract real DOM node first
    const domHandle = await locator.elementHandle();
    if (domHandle) {
      await this.page.evaluate(el => el.click(), domHandle);
      await wait(6000);
      await saveSnapshot(this.page, 'created');
      console.log(`🎉 Project "${this.projectName}" created (via JS click).`);
      return true;
    }
  }

  console.warn("❌ Create Project button not found.");
  return false;
}


  async execute() {
    await this.init();
    await this.navigate();

    const ok = await this.goToProjects()
      && await this.addProject()
      && await this.fillProjectName()
      && await this.createProject();

    if (!ok) console.error('💀 Agent failed to complete flow.');
    else console.log('✅ Agent finished successfully.');

    await this.ctx.storageState({ path: SESSION_FILE });
    await this.ctx.close();
  }
}

(async () => {
  const goal = process.argv.slice(2).join(' ') || 'create a project named AutoAgent';
  const agent = new LinearAgent(goal);
  await agent.execute();
})();
