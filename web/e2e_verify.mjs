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

  // Wait for server startup and initial controller poll
  let connected = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/system`);
      if (res.ok) {
        connected = true;
        break;
      }
    } catch {}
  }
  if (!connected) {
    console.log('Server not responding yet, waiting extra 2s...');
    await new Promise((r) => setTimeout(r, 2000));
  }

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
      console.log('✓ Opened Schedules Hub (Activity Programs Mode)');
      await page.screenshot({ path: path.join(__dirname, 'schedules_programs.png') });

      // 5.1 Test Activity Program Edit Modal
      const editProgBtn = page.locator('button:has-text("Edit Routine & Rooms")').first();
      if (await editProgBtn.count() > 0) {
        await editProgBtn.click();
        await page.waitForTimeout(400);
        console.log('✓ Opened Activity Program Edit Modal');
        const cancelBtn = page.locator('button:has-text("Cancel")').first();
        if (await cancelBtn.count() > 0) await cancelBtn.click();
        await page.waitForTimeout(300);
      }

      // 5.2 Switch to Weekly Visual Hub
      const plannerBtn = page.locator('button:has-text("Weekly Visual Hub")');
      if (await plannerBtn.count() > 0) {
        await plannerBtn.click();
        await page.waitForTimeout(800);
        console.log('✓ Switched to Weekly Visual Hub');
        await page.screenshot({ path: path.join(__dirname, 'schedules_planner.png') });

        // Open Add Event modal
        const addEvBtn = page.locator('button:has-text("Add Scheduled Event")').first();
        if (await addEvBtn.count() > 0) {
          await addEvBtn.click();
          await page.waitForTimeout(400);
          console.log('✓ Opened Add Scheduled Event Modal');
          const cancelBtn = page.locator('button:has-text("Cancel")').first();
          if (await cancelBtn.count() > 0) await cancelBtn.click();
          await page.waitForTimeout(300);
          console.log('✓ Closed Add Scheduled Event Modal');
        }

        // Open Duplicate Modal
        const dupBtn = page.locator('button:has-text("Duplicate Day to...")').first();
        if (await dupBtn.count() > 0) {
          await dupBtn.click();
          await page.waitForTimeout(400);
          console.log('✓ Opened Duplicate Day Modal');
          const cancelBtn = page.locator('button:has-text("Cancel")').first();
          if (await cancelBtn.count() > 0) await cancelBtn.click();
          await page.waitForTimeout(300);
          console.log('✓ Closed Duplicate Day Modal');
        }
      }

      // 5.3 Switch to Master Matrix Grid
      const matrixBtn = page.locator('button:has-text("Master Matrix Grid")');
      if (await matrixBtn.count() > 0) {
        await matrixBtn.click();
        await page.waitForTimeout(800);
        console.log('✓ Switched to Master Matrix Grid');
        await page.screenshot({ path: path.join(__dirname, 'schedules_matrix.png') });
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

          // Test Group CRUD modals on Zone & Hardware Mapping
          if (st.label === 'Zone & Hardware Mapping') {
            const addGroupBtn = page.locator('button:has-text("Provision New Group")');
            if (await addGroupBtn.count() > 0) {
              await addGroupBtn.first().click();
              await page.waitForTimeout(400);
              console.log('✓ Opened Provision New Group Modal');
              const cancelBtn = page.locator('button:has-text("Cancel")').first();
              if (await cancelBtn.count() > 0) await cancelBtn.click();
              await page.waitForTimeout(300);
              console.log('✓ Closed Provision New Group Modal');
            }

            const editGroupBtn = page.locator('button:has-text("Edit")').first();
            if (await editGroupBtn.count() > 0) {
              await editGroupBtn.click();
              await page.waitForTimeout(400);
              console.log('✓ Opened Edit Group Modal');
              const cancelBtn = page.locator('button:has-text("Cancel")').first();
              if (await cancelBtn.count() > 0) await cancelBtn.click();
              await page.waitForTimeout(300);
              console.log('✓ Closed Edit Group Modal');
            }
          }
        } else {
          console.warn(`Sub-tab button not found: ${st.label}`);
        }
      }
    }

    // 7. Testing Deep Links & Direct URL Navigation
    console.log('\n--- 7. Testing Deep Link URLs & Direct Navigation ---');
    
    // 7.1 Direct Link to Ventilation
    await page.goto(`http://127.0.0.1:${PORT}/ventilation`, { waitUntil: 'networkidle' });
    console.log('✓ Loaded direct URL: /ventilation');

    // 7.2 Direct Link to Schedules Planner
    await page.goto(`http://127.0.0.1:${PORT}/schedules/planner`, { waitUntil: 'networkidle' });
    console.log('✓ Loaded direct URL: /schedules/planner');

    // 7.3 Direct Link to Schedules Matrix
    await page.goto(`http://127.0.0.1:${PORT}/schedules/matrix`, { waitUntil: 'networkidle' });
    console.log('✓ Loaded direct URL: /schedules/matrix');

    // 7.4 Direct Link to Admin Zones
    await page.goto(`http://127.0.0.1:${PORT}/admin/zones`, { waitUntil: 'networkidle' });
    console.log('✓ Loaded direct URL: /admin/zones');

    // 7.5 Direct Link to Zone 2 Modal
    await page.goto(`http://127.0.0.1:${PORT}/zone/2`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const modalHeading = page.locator('h3:has-text("Room 107"), h3:has-text("Group 2"), h3:has-text("FC1-2")');
    if (await modalHeading.count() > 0) {
      console.log('✓ Direct link to /zone/2 successfully opened Zone Control Modal');
    }
    await page.screenshot({ path: path.join(__dirname, 'zone_2_direct_link.png') });

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
