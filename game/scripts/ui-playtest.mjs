import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: node scripts/ui-playtest.mjs <dev-server-url>');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

function doRectsOverlap(a, b) {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}

async function checkVisibleReadouts(page) {
  for (const label of ['Money', 'Fuel', 'Supplies', 'Driver']) {
    assert(await page.locator(`[data-resource="${label}"]`).isVisible(), `${label} must remain visible`);
  }
  assert(await page.locator('.log').isVisible(), 'Event log must remain visible');
  const boxes = await page.locator('.modal:visible,.instruments,.log').evaluateAll(nodes => nodes.map(node => ({
    name: node.className, rect: node.getBoundingClientRect().toJSON(),
  })));
  const modal = boxes.find(box => box.name.includes('modal'));
  for (const box of boxes.filter(box => box !== modal)) {
    assert(!doRectsOverlap(modal.rect, box.rect), `${box.name} must not cover the modal`);
  }
}

async function checkInstruments(page) {
  const clock = page.locator('.instrument-clock');
  assert(await clock.isVisible(), 'Clock strip must be visible');
  const m = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const visibleRect = selector => {
      const node = document.querySelector(selector);
      return node && node.offsetParent !== null ? node.getBoundingClientRect().toJSON() : null;
    };
    return {
      panel: rect('.instruments'), clock: rect('.instrument-clock'), dial: rect('.truck-instrument'), readouts: rect('.readouts'),
      log: visibleRect('.log'), weapons: visibleRect('.weapons'),
      clockText: document.querySelector('.instrument-clock').innerText,
      panelText: document.querySelector('.instruments').innerText,
      actionsText: document.querySelector('.instrument-actions').innerText,
      speedoText: document.querySelector('.speedometer').innerText,
      heights: [...document.querySelectorAll('.instrument-actions > button')].map(node => node.getBoundingClientRect().height),
    };
  });
  const { panel } = m;
  assert(m.clock.x >= panel.x && m.clock.right <= panel.right && m.clock.y >= panel.y && m.clock.bottom <= panel.bottom, 'Clock must lie inside the instruments');
  assert(m.clock.bottom <= m.dial.y && m.clock.bottom <= m.readouts.y, 'Clock must sit above the dial and readouts');
  assert(/Day \d+\s+\d+:\d\d/.test(m.clockText), `Clock must show day and time, got ${m.clockText}`);
  assert.equal(m.panelText.match(/Day \d+\s+\d+:\d\d/g).length, 1, 'Time must show once');
  assert(!m.actionsText.includes('broken'), 'No broken badge in the action row');
  assert(!/km\/h|·/.test(m.speedoText), 'No unit text under the dial');
  assert(m.heights.every(h => Math.abs(h - m.heights[0]) <= 1), `Action buttons must share one height: ${m.heights}`);
  for (const other of [m.log, m.weapons].filter(Boolean)) {
    assert(!doRectsOverlap(panel, other), 'Instruments must not overlap the log or weapons');
  }
}

// The radio sits above the log, clear of the other right-hand panels, with its knobs and a broadcast on screen.
async function checkRadio(page) {
  await page.waitForFunction(() => document.querySelector('.radio-text')?.textContent.trim(), null, { timeout: 30000 });
  const m = await page.evaluate(() => {
    const visibleRect = selector => {
      const node = document.querySelector(selector);
      return node && node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden' ? node.getBoundingClientRect().toJSON() : null;
    };
    return {
      radio: visibleRect('.radio'), log: visibleRect('.log'), others: ['.instruments', '.contracts', '.info'].map(visibleRect).filter(Boolean),
      knobs: document.querySelectorAll('.radio [role=slider]').length, oldSound: document.querySelectorAll('.top-right .sound').length,
    };
  });
  assert(m.radio, 'Radio must be visible');
  assert.equal(m.knobs, 4, 'Radio must carry four volume knobs');
  assert.equal(m.oldSound, 0, 'The top-right Sound panel must be gone');
  assert(m.radio.bottom <= m.log.y, 'Radio must sit above the log');
  for (const other of [m.log, ...m.others]) assert(!doRectsOverlap(m.radio, other), 'Radio must not overlap the log, instruments, contracts or info');
}

// The hover panel at its smallest never covers the radio. On a screen too short for both, the radio steps away while
// the panel shows, the panel reaches down to the log, and the radio comes back after.
async function checkRadioUnderInfo(page, radioStays) {
  const m = await page.evaluate(() => {
    const info = document.querySelector('.info');
    const radio = document.querySelector('.radio');
    const was = info.style.display;
    info.style.display = '';
    const seen = { info: info.getBoundingClientRect().toJSON(), radio: radio.getBoundingClientRect().toJSON(), log: document.querySelector('.log').getBoundingClientRect().toJSON(), shown: getComputedStyle(radio).visibility !== 'hidden' };
    info.style.display = was;
    return { ...seen, after: getComputedStyle(radio).visibility !== 'hidden' };
  });
  const size = page.viewportSize();
  assert(m.after, 'The radio must come back once the hover panel hides');
  assert.equal(m.shown, radioStays, `At ${size.width}x${size.height} the radio must ${radioStays ? 'stay' : 'step away'} under the hover panel`);
  assert(!doRectsOverlap(m.log, m.info), `At ${size.width}x${size.height} the hover panel must stop above the log`);
  if (m.shown) assert(!doRectsOverlap(m.radio, m.info), `At ${size.width}x${size.height} the hover panel must not cover the radio`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ROAM__?.state);
  assert(await page.locator('.icon').evaluateAll(nodes => nodes.every(node => node.title)), 'Every icon needs a hover name');
  assert(await page.locator('#ui *').evaluateAll(nodes => nodes.filter(node => !node.closest('button.switch')).every(node => !getComputedStyle(node).backgroundImage.includes('gradient'))), 'UI must use flat surfaces, apart from the metal switches');
  await checkInstruments(page);
  await checkRadio(page);
  await page.keyboard.press('i');
  await checkVisibleReadouts(page);
  const movable = page.locator('.inv-item:not(.fixed)').first();
  const name = (await movable.getAttribute('title')).split('\n')[0].split(' (')[0];
  await movable.click();
  assert((await page.locator('.inv-inspection').innerText()).includes(name), 'Clicking a movable item must inspect it before drag/drop replaces its node');
  const inventoryFrame = await page.locator('.modal:visible').boundingBox();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await checkVisibleReadouts(page);
  assert.deepEqual(await page.locator('.modal:visible').boundingBox(), inventoryFrame, 'Character and inventory must share one frame');
  await page.keyboard.press('Escape');
  // The truck starts in the wasteland now, so the town frame is checked only when E opens a modal.
  await page.keyboard.press('e');
  if (await page.locator('.modal:visible').count()) {
    await checkVisibleReadouts(page);
    assert.deepEqual(await page.locator('.modal:visible').boundingBox(), inventoryFrame, 'Town and inventory must share one frame');
  } else {
    await page.keyboard.press('i');
    await checkVisibleReadouts(page);
  }
  for (const width of [1024, 800, 700]) {
    await page.setViewportSize({ width, height: 800 });
    await checkVisibleReadouts(page);
    await checkInstruments(page);
  }
  await page.keyboard.press('Escape');
  for (const [width, height] of [[1280, 768], [700, 800]]) {
    await page.setViewportSize({ width, height });
    await checkRadio(page);
  }
  for (const [width, height, radioStays] of [[1280, 720, false], [1366, 657, false], [1280, 768, false], [1280, 800, true], [700, 800, false], [700, 940, true]]) {
    await page.setViewportSize({ width, height });
    await checkRadioUnderInfo(page, radioStays);
  }
  assert.deepEqual(errors, [], 'No uncaught page errors');
  await mkdir('.playtest', { recursive: true });
  await page.screenshot({ path: '.playtest/ui-regression.png' });
  console.log('PASS: hover names, flat surfaces, persistent resources/log, the radio above the log and clear of the hover panel, stable modal frames, movable-item inspection, and laptop/narrow layouts, clock strip, speedometer and action row');
} finally {
  await browser.close();
}
