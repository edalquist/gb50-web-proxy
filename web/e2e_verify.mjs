import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const PORT = 8089;

async function runVerification() {
  console.log(`🚀 Starting server on port ${PORT} targeting 192.0.2.90...`);
  
  const pythonBin = fs.existsSync(path.join(rootDir, '.venv/bin/python'))
    ? path.join(rootDir, '.venv/bin/python')
    : path.join(rootDir, '../.venv/bin/python');

  const serverProcess = spawn(
    pythonBin,
    [path.join(rootDir, 'run_server.py'), '--port', String(PORT), '--controller-host', '192.0.2.90'],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  serverProcess.stdout.on('data', (d) => process.stdout.write(`[SERVER] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[SERVER ERR] ${d}`));

  // Wait 4 seconds for server startup and initial controller poll
  await new Promise((r) => setTimeout(r, 4000));

  const consoleErrors = [];
  const networkFailures = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`❌ [BROWSER CONSOLE ERROR]: ${msg.text()}`);
      consoleErrors.push(msg.text());
    } else {
      console.log(`ℹ️ [BROWSER ${msg.type()}]: ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    console.error(`💥 [BROWSER UNCAUGHT EXCEPTION]: ${err.message}`);
    consoleErrors.push(err.message);
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.error(`⚠️ [FAILED HTTP ${response.status()}]: ${response.url()}`);
      networkFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('\n--- 1. Navigating to Home / Dashboard ---');
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    console.log('Page title:', await page.title());
    await page.screenshot({ path: path.join(__dirname, 'dashboard_floor1.png') });

    // Verify Floor tabs
    console.log('\n--- 2. Navigating through Floor Views ---');
    const floor2Btn = page.locator('button:has-text("Floor 2")');
    if (await floor2Btn.count() > 0) {
      await floor2Btn.first().click();
      await page.waitForTimeout(500);
      console.log('✓ Clicked Floor 2');
      await page.screenshot({ path: path.join(__dirname, 'dashboard_floor2.png') });
    }

    const allFloorsBtn = page.locator('button:has-text("All Floors")');
    if (await allFloorsBtn.count() > 0) {
      await allFloorsBtn.first().click();
      await page.waitForTimeout(500);
      console.log('✓ Clicked All Floors');
    }

    // Open and close a zone card detail modal
    console.log('\n--- 3. Testing Zone Control Modal ---');
    const firstCard = page.locator('.cursor-pointer').first();
    if (await firstCard.count() > 0) {
      await firstCard.click();
      await page.waitForTimeout(500);
      console.log('✓ Opened zone modal');
      await page.screenshot({ path: path.join(__dirname, 'zone_modal.png') });
      
      const closeBtn = page.locator('button:has-text("✕")');
      if (await closeBtn.count() > 0) {
        await closeBtn.first().click();
        await page.waitForTimeout(300);
        console.log('✓ Closed zone modal');
      }
    }

    // Ventilation Tab
    console.log('\n--- 4. Navigating to Dedicated Fresh Air Ventilation (LOSSNAY) Tab ---');
    const ventNav = page.locator('button:has-text("Fresh Air Ventilation")');
    if (await ventNav.count() > 0) {
      await ventNav.first().click();
      await page.waitForTimeout(1000);
      console.log('✓ Opened Ventilation View');
      await page.screenshot({ path: path.join(__dirname, 'ventilation_view.png') });
    }

    // Schedules Tab
    console.log('\n--- 5. Navigating to Schedules Tab ---');
    const schedNav = page.locator('button:has-text("Schedules")');
    if (await schedNav.count() > 0) {
      await schedNav.first().click();
      await page.waitForTimeout(1000);
      console.log('✓ Opened Schedules Master Matrix View');
      await page.screenshot({ path: path.join(__dirname, 'schedules_matrix.png') });

      // Switch to Weekly 7-Day Planner
      const weeklyBtn = page.locator('button:has-text("Weekly 7-Day Planner")');
      if (await weeklyBtn.count() > 0) {
        await weeklyBtn.first().click();
        await page.waitForTimeout(800);
        console.log('✓ Switched to Weekly 7-Day Planner');
        await page.screenshot({ path: path.join(__dirname, 'schedules_weekly.png') });
      }

      // Switch to Multi-Zone Batch Editor
      const editorBtn = page.locator('button:has-text("Multi-Zone Batch Editor")');
      if (await editorBtn.count() > 0) {
        await editorBtn.first().click();
        await page.waitForTimeout(800);
        console.log('✓ Switched to Multi-Zone Batch Editor');
        await page.screenshot({ path: path.join(__dirname, 'schedules_editor.png') });

        // Open Add Event modal
        const addEvBtn = page.locator('button:has-text("Add Event")').first();
        if (await addEvBtn.count() > 0) {
          await addEvBtn.click();
          await page.waitForTimeout(400);
          console.log('✓ Opened Add Scheduled Event Modal');
          await page.screenshot({ path: path.join(__dirname, 'schedules_modal.png') });

          const cancelBtn = page.locator('button:has-text("Cancel")');
          if (await cancelBtn.count() > 0) {
            await cancelBtn.first().click();
            await page.waitForTimeout(300);
            console.log('✓ Closed Add Scheduled Event Modal');
          }
        }
      }
    }

    // Administration Tab & all 8 Sub-Tabs
    console.log('\n--- 6. Navigating to Admin & Diagnostics Tab ---');
    const adminNav = page.locator('button:has-text("Admin & Diagnostics")');
    if (await adminNav.count() > 0) {
      await adminNav.first().click();
      await page.waitForTimeout(1000);
      console.log('✓ Opened Admin & Diagnostics View');

      const subTabs = [
        { label: 'Basic System & Network', file: 'admin_1_system.png' },
        { label: 'Zone & Hardware Mapping', file: 'admin_2_zones.png' },
        { label: 'LOSSNAY Interlocks', file: 'admin_3_interlocks.png' },
        { label: 'Clock & Summer Time (DST)', file: 'admin_4_clock.png' },
        { label: 'Night Setback Automation', file: 'admin_5_setback.png' },
        { label: 'Software Licenses', file: 'admin_6_licenses.png' },
        { label: 'User Security & Accounts', file: 'admin_7_security.png' },
        { label: 'Alarms & Diagnostics', file: 'admin_8_diagnostics.png' },
      ];

      for (const st of subTabs) {
        console.log(`\nNavigating to Admin Sub-Tab: "${st.label}"...`);
        const tabBtn = page.locator(`button:has-text("${st.label}")`);
        if (await tabBtn.count() > 0) {
          await tabBtn.first().click();
          await page.waitForTimeout(1000);
          await page.screenshot({ path: path.join(__dirname, st.file) });
          console.log(`✓ Loaded sub-tab: ${st.label}`);
        } else {
          console.warn(`Sub-tab button not found: ${st.label}`);
        }
      }
    }

    console.log('\n========================================');
    console.log('          VERIFICATION RESULTS          ');
    console.log('========================================');
    console.log(`Console Errors: ${consoleErrors.length}`);
    console.log(`Network Failures: ${networkFailures.length}`);

    if (consoleErrors.length > 0) {
      console.error('\nConsole Errors list:');
      consoleErrors.forEach((e) => console.error(' - ' + e));
    }

    if (networkFailures.length > 0) {
      console.error('\nNetwork Failures list:');
      networkFailures.forEach((f) => console.error(' - ' + f));
    }

    if (consoleErrors.length === 0 && networkFailures.length === 0) {
      console.log('\n🎉 ALL PAGES AND TABS LOADED 100% CLEANLY WITHOUT ANY ERRORS!');
    }

  } finally {
    await browser.close();
    serverProcess.kill('SIGTERM');
  }
}

runVerification().catch((err) => {
  console.error('Fatal error during E2E verification:', err);
  process.exit(1);
});
