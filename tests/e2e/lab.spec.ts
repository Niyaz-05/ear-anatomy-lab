import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'docs/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function open(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`/${query}`);
  return errors;
}
async function ready(page: Page) {
  await expect(page.locator('.viewer[data-ready="true"]')).toBeVisible({ timeout: 90_000 });
  await settle(page);
}
/** Waits until the canvas has rendered two more frames (software WebGL can be slow to compile shaders). */
async function settle(page: Page, ms = 1000) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
}
const detailTitle = (page: Page) => page.locator('#detail-title');
const listButton = (page: Page, name: string | RegExp) => page.locator('.struct-list button', { hasText: name });
const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const mode = (page: Page, name: string) => page.locator('nav[aria-label="Mode"] button', { hasText: new RegExp(`^${name}$`) }).click();
const cameraButton = (page: Page, name: string) => page.locator('[aria-label="Camera views"] button', { hasText: new RegExp(`^${name}$`) });
const num = async (page: Page, sel: string, attr: string) => Number(await page.locator(sel).first().getAttribute(attr));

test('loads the ear without console errors and with a clean main screen @smoke', async ({ page }) => {
  const errors = await open(page);
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Human Ear', level: 1 })).toBeVisible();
  await expect(page.locator('aside.right')).toHaveCount(0);
  await expect(radio(page, 'Real')).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `${SHOTS}/01-initial.png` });
  expect(errors).toEqual([]);
});

test('clicking the model selects the structure under the pointer', async ({ page }) => {
  await open(page);
  await ready(page);
  const box = (await page.locator('.viewer canvas').boundingBox())!;
  // The free area between the panels: the canal and the window into the bone are in its middle.
  await page.mouse.click(box.x + 318 + (box.width - 318) / 2, box.y + 70 + (box.height - 150) / 2);
  await expect(detailTitle(page)).toHaveText(/./);
  await expect(page.locator('aside.right')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-selected.png` });
});

test('search finds structures by name and synonym', async ({ page }) => {
  await open(page);
  await ready(page);
  const search = page.getByLabel('Search structures');
  await search.fill('stirrup');
  await search.press('Enter');
  await expect(detailTitle(page)).toHaveText('Stapes (stirrup)');
  await search.fill('CN VIII');
  await expect(page.locator('.search-results')).toContainText('Vestibulocochlear nerve');
  await search.fill('zzzz');
  await expect(page.getByText('No structure matches')).toBeVisible();
  await search.press('Escape');
  await expect(page.locator('fieldset.layers')).toBeVisible();
});

test('a group lists its parts and a part links back to its group', async ({ page }) => {
  await open(page);
  await ready(page);
  await listButton(page, /^Auditory ossicles$/).click();
  await expect(detailTitle(page)).toHaveText('Auditory ossicles');
  await expect(page.locator('aside.right')).toContainText('3 parts');
  await page.locator('aside.right .chips button', { hasText: 'Malleus' }).click();
  await expect(detailTitle(page)).toHaveText('Malleus (hammer)');
  await page.locator('aside.right .chip-row button', { hasText: 'Auditory ossicles' }).click();
  await expect(detailTitle(page)).toHaveText('Auditory ossicles');
});

test('colour by layer paints each layer', async ({ page }) => {
  await open(page);
  await ready(page);
  const canvas = page.locator('.viewer canvas');
  const real = await canvas.screenshot();
  await radio(page, 'Layers').click();
  await settle(page);
  expect(Buffer.compare(real, await canvas.screenshot())).not.toBe(0);
  await page.screenshot({ path: `${SHOTS}/03-colour-layers.png` });
});

test('layers hide and show structures', async ({ page }) => {
  await open(page);
  await ready(page);
  await expect(listButton(page, /^Temporal bone/).locator('.tag')).toHaveCount(0);
  await page.getByLabel('Temporal bone and skull').uncheck();
  await expect(listButton(page, /^Temporal bone/).locator('.tag')).toHaveText('hidden');
  await page.getByLabel('Blood vessels').uncheck();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/04-no-bone.png` });
});

test('isolate, zoom and reset', async ({ page }) => {
  await open(page);
  await ready(page);
  await listButton(page, /^Cochlea/).first().click();
  await page.getByLabel('Isolate').check();
  await expect(listButton(page, /^Auricle/).locator('.tag')).toHaveText('hidden');
  await page.getByRole('button', { name: 'Zoom to' }).click();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/05-isolated-cochlea.png` });
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(detailTitle(page)).toHaveCount(0);
  await expect(listButton(page, /^Auricle/).locator('.tag')).toHaveCount(0);
});

test('camera presets switch views', async ({ page }) => {
  await open(page);
  await ready(page);
  const canvas = page.locator('.viewer canvas');
  const first = await canvas.screenshot();
  await cameraButton(page, 'Inner ear').click();
  await settle(page, 1200);
  expect(Buffer.compare(first, await canvas.screenshot())).not.toBe(0);
});

test('labels mode shows non-overlapping labels', async ({ page }) => {
  await open(page);
  await ready(page);
  await page.getByLabel('Labels').check();
  await settle(page, 1500);
  const shown = page.locator('.scene-label[data-state="shown"]');
  expect(await shown.count()).toBeGreaterThanOrEqual(3);
  const boxes = await shown.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i]!, boxes[j]!];
    expect(!(a[2]! <= b[0]! || b[2]! <= a[0]! || a[3]! <= b[1]! || b[3]! <= a[1]!), `labels ${i} and ${j} overlap`).toBe(false);
  }
  // Legible: at least 11 px text.
  const size = await shown.first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(size).toBeGreaterThanOrEqual(11);
  await page.screenshot({ path: `${SHOTS}/06-labels.png` });
});

test('the cut opens the temporal bone, faces the camera to it, and can be flipped and turned off', async ({ page }) => {
  const errors = await open(page);
  await ready(page);
  const canvas = page.locator('.viewer canvas');
  const whole = await canvas.screenshot();
  await radio(page, 'Front').click();
  await expect(cameraButton(page, 'Front')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slice-hint')).toHaveText('Showing the back part');
  await settle(page, 2500);
  expect(Buffer.compare(whole, await canvas.screenshot())).not.toBe(0);
  await page.screenshot({ path: `${SHOTS}/07-cut-coronal.png` });
  await page.getByRole('button', { name: 'Flip' }).click();
  await expect(cameraButton(page, 'Back')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slice-hint')).toHaveText('Showing the front part');
  await radio(page, 'Off').click();
  await expect(page.getByLabel('Cut position')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Hearing: the frequency moves the place on the basilar membrane; level, audibility and exposure follow', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Hearing');
  const panel = page.locator('.hearing-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-place]')).toHaveAttribute('data-place', '21.0');
  // The 3D place marker's label follows the tone.
  await expect(page.locator('.point-label[data-point="place"]')).toContainText('1.0 kHz place');
  const canvas = page.locator('.viewer canvas');
  await settle(page, 1500);
  const a = await canvas.screenshot();
  await page.waitForTimeout(400);
  expect(Buffer.compare(a, await canvas.screenshot()), 'the scene animates').not.toBe(0);
  await page.screenshot({ path: `${SHOTS}/08-hearing-1k.png` });

  await page.getByRole('button', { name: '8 kHz' }).click();
  await expect.poll(() => num(page, '.hearing-panel [data-place]', 'data-place')).toBeLessThan(10);
  await expect(page.locator('.point-label[data-point="place"]')).toContainText('8.0 kHz place');
  await expect(panel.locator('.bm-wave')).toHaveAttribute('data-peak-mm', /^[0-9]\./);
  // The slider: the lowest frequencies peak near the apex.
  await page.getByLabel('Frequency', { exact: true }).fill('100');
  await expect.poll(() => num(page, '.hearing-panel [data-place]', 'data-place')).toBeGreaterThan(30);
  await page.getByLabel('Level', { exact: true }).fill('5');
  await expect(panel.locator('[data-audible]')).toHaveAttribute('data-audible', 'false');
  await page.getByRole('button', { name: 'Concert, 110 dB' }).click();
  await expect(panel.locator('[data-risk]')).toHaveAttribute('data-risk', 'dangerous');
  await expect(panel.locator('[data-audible]')).toHaveAttribute('data-audible', 'true');
  // The optional tone: off until pressed, and gone with the panel when the mode changes.
  const tone = page.getByRole('button', { name: /Play tone/ });
  await expect(tone).toHaveAttribute('aria-pressed', 'false');
  await tone.click();
  await expect(page.getByRole('button', { name: /Stop tone/ })).toHaveAttribute('aria-pressed', 'true');
  await settle(page, 1200);
  await page.screenshot({ path: `${SHOTS}/09-hearing-concert.png` });
  await mode(page, 'Anatomy');
  await expect(page.getByRole('button', { name: /Stop tone/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Balance: a head turn drives the canals in push–pull; spin and stop runs; the otoliths sense tilt', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Balance');
  const panel = page.locator('.balance-panel');
  await expect(panel).toBeVisible();
  await page.getByRole('radio', { name: 'Shake' }).click();
  await expect.poll(async () => {
    const l = await num(page, '[data-canal="left-lateral"]', 'data-rate');
    const r = await num(page, '[data-canal="right-lateral"]', 'data-rate');
    return Math.abs(l - r);
  }, { timeout: 10_000 }).toBeGreaterThan(40);
  await settle(page, 600);
  await page.screenshot({ path: `${SHOTS}/10-balance-shake.png` });
  await page.getByRole('radio', { name: 'Still' }).click();
  await page.getByRole('button', { name: /Turn left/ }).click();
  await expect.poll(() => num(page, '[data-canal="left-lateral"]', 'data-rate'), { timeout: 5_000, intervals: [50] }).toBeGreaterThan(110);
  await expect.poll(() => num(page, '.head-icon', 'data-yaw')).toBeGreaterThan(25);

  await page.getByRole('button', { name: 'Spin, then stop' }).click();
  await expect(panel.locator('.spin-block')).toHaveAttribute('data-phase', 'spinning');
  await expect.poll(() => num(page, '[data-spin-t]', 'data-spin-t'), { timeout: 10_000 }).toBeGreaterThan(4);
  await expect(panel.locator('.nyst-trace')).toBeVisible();
  await expect(panel.locator('[data-beat]')).toHaveAttribute('data-beat', 'left');
  await page.screenshot({ path: `${SHOTS}/11-balance-spin.png` });

  await page.getByLabel('Head pitch', { exact: true }).fill('30');
  await expect(panel.locator('[data-tilt]')).toHaveAttribute('data-tilt', '30');
  await expect(panel.locator('[data-ambiguity]')).toContainText('accelerating forwards at 4.9 m/s²');
  expect(errors).toEqual([]);
});

test('Clinic: a case switch changes the classification; tests, your own audiogram and implants', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Clinic');
  const panel = page.locator('.clinic-panel');
  const cls = panel.locator('.classification');
  await expect(cls).toHaveAttribute('data-right-type', 'conductive');
  await expect(panel.locator('.forks')).toHaveAttribute('data-rinne-right', 'negative');
  await expect(panel.locator('.audiogram')).toBeVisible();
  await settle(page, 1500);
  await page.screenshot({ path: `${SHOTS}/12-clinic-otosclerosis.png` });

  await page.getByLabel('Case', { exact: true }).selectOption('noise-induced');
  await expect(cls).toHaveAttribute('data-right-type', 'sensorineural');
  await expect(panel.locator('.forks')).toHaveAttribute('data-weber', 'midline');
  await page.getByLabel('Case', { exact: true }).selectOption('sudden-snhl');
  await expect(cls).toHaveAttribute('data-right-grade', 'severe');
  await expect(panel.locator('.forks')).toHaveAttribute('data-weber', 'left');
  await expect(panel.locator('.forks')).toHaveAttribute('data-rinne-right', 'negative'); // false negative

  // Build your own: raise the right air thresholds → a conductive loss; then bone too → sensorineural.
  await radio(page, 'Your audiogram').click();
  await expect(cls).toHaveAttribute('data-right-type', 'normal');
  const chart = panel.locator('.audiogram.editable');
  const click = async (freqIndex: number, db: number) => {
    const b = (await chart.boundingBox())!;
    const k = b.width / 300;
    const x = (34 + 10 + (freqIndex / 5) * (246 - 34 - 20)) * k, y = (18 + ((db + 10) / 130) * (214 - 18)) * k;
    await page.mouse.click(b.x + x, b.y + y);
  };
  for (const i of [1, 2, 3, 4]) await click(i, 50); // 500, 1k, 2k, 4k
  await expect(cls).toHaveAttribute('data-right-type', 'conductive');
  await expect(cls).toHaveAttribute('data-right-grade', 'moderately-severe');
  await page.getByRole('radio', { name: /Right bone/ }).click();
  for (const i of [1, 2, 3, 4]) await click(i, 50);
  await expect(cls).toHaveAttribute('data-right-type', 'sensorineural');
  // The keyboard moves a focused symbol in 5 dB steps.
  const point = panel.locator('.aud-point.active[data-freq="1000"]');
  await point.focus();
  await page.keyboard.press('ArrowUp');
  await expect(point).toHaveAttribute('data-db', '45');
  await page.screenshot({ path: `${SHOTS}/13-clinic-build.png` });

  await radio(page, 'Aids & implants').click();
  const lowest = await num(page, '[data-lowest]', 'data-lowest');
  await page.getByLabel('Insertion depth', { exact: true }).fill('30');
  await expect.poll(() => num(page, '[data-lowest]', 'data-lowest')).toBeLessThan(lowest);
  await settle(page, 1500);
  await page.screenshot({ path: `${SHOTS}/14-clinic-implant.png` });
  expect(errors).toEqual([]);
});

test('Close-ups: ossicles, cochlear duct, crista, macula, ear pressure and BPPV', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Close-ups');
  const panel = page.locator('.closeups-panel');
  await expect(page.locator('.point-label[data-point="footplate"]')).toHaveCount(1);
  await settle(page, 1500);
  await page.screenshot({ path: `${SHOTS}/15-closeup-ossicles.png` });

  await radio(page, 'Cochlear duct').click();
  await panel.getByRole('button', { name: /Stria vascularis/ }).click();
  await expect(panel.locator('.schematic-note')).toContainText('endocochlear potential');
  await settle(page, 1500);
  await page.screenshot({ path: `${SHOTS}/16-closeup-cochlea.png` });

  await radio(page, 'Crista').click();
  await page.getByRole('button', { name: /Turn head right/ }).click();
  await expect.poll(() => num(page, '.closeups-panel [data-rate]', 'data-rate'), { timeout: 5_000, intervals: [50] }).toBeGreaterThan(110);

  await radio(page, 'Macula').click();
  await page.getByLabel('Head roll', { exact: true }).fill('40');
  await expect(panel.locator('.otoconia-layer')).toBeVisible();

  await radio(page, 'Ear pressure').click();
  await page.getByLabel('Cabin altitude', { exact: true }).fill('2400');
  await expect(panel.locator('[data-drum]')).toHaveAttribute('data-drum', 'bulging-out');
  await page.getByRole('button', { name: 'Swallow / Valsalva' }).click();
  await expect(panel.locator('[data-drum]')).toHaveAttribute('data-drum', 'neutral');
  await page.getByLabel('Cabin altitude', { exact: true }).fill('0');
  await expect(panel.locator('[data-drum]')).toHaveAttribute('data-drum', 'pushed-in');
  await settle(page, 1500);
  await page.screenshot({ path: `${SHOTS}/17-closeup-pressure.png` });

  await radio(page, 'BPPV').click();
  await radio(page, 'Head right, lie back').click();
  await expect(panel.locator('[data-provoked]')).toHaveAttribute('data-provoked', 'true');
  await radio(page, 'Head left, lie back').click();
  await expect(panel.locator('[data-provoked]')).toHaveAttribute('data-provoked', 'false');
  await page.getByRole('button', { name: 'Start →' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next →' }).click();
  await expect(panel.locator('[data-epley-step]')).toHaveAttribute('data-epley-step', '5');
  await expect(panel).toContainText('back in the utricle');
  await settle(page, 2000);
  await page.screenshot({ path: `${SHOTS}/18-closeup-bppv.png` });
  expect(errors).toEqual([]);
});

test('guided tour drives the modes, navigates, lets you try a step, and finishes', async ({ page }) => {
  test.slow();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Guided tour');
  await expect(page.getByText(/step 1 of 24/)).toBeVisible();
  await expect(page.locator('#tour-title')).toHaveText('Three parts of the ear');
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.locator('#tour-title')).toHaveText('A canal that resonates');
  await expect(page.locator('.mode-tag')).toContainText('Hearing · 3.4 kHz');
  await settle(page, 2500);
  await page.screenshot({ path: `${SHOTS}/19-tour-canal.png` });
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByText(/step 2 of 24/)).toBeVisible();
  await page.locator('.tour-index button', { hasText: 'Spin, then stop' }).click();
  await expect(page.locator('.mode-tag')).toContainText('spin and stop');
  await page.getByRole('button', { name: 'Try it yourself →' }).click();
  await expect(page.getByRole('button', { name: 'Balance' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.balance-panel')).toBeVisible();
  await mode(page, 'Guided tour');
  await page.locator('.tour-index button').last().click();
  await expect(page.getByText(/step 24 of 24/)).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('button', { name: 'Anatomy' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('phone layout: structures open from the dock and details follow a pick @smoke', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await ready(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('aside.left')).toBeHidden();
  await page.getByRole('button', { name: 'Structures' }).click();
  await listButton(page, /^Stapes/).click();
  await expect(page.locator('aside.left')).toBeHidden();
  await expect(detailTitle(page)).toHaveText('Stapes (stirrup)');
  await page.screenshot({ path: `${SHOTS}/20-phone.png` });
});

test('the About sheet holds the BodyParts3D credits', async ({ page }) => {
  await open(page);
  await ready(page);
  await page.getByRole('button', { name: /About this lab/ }).click();
  const dialog = page.getByRole('dialog', { name: 'About this lab' });
  await expect(dialog).toContainText('BodyParts3D');
  await expect(dialog).toContainText('CC BY 4.0');
  await page.screenshot({ path: `${SHOTS}/21-about.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('without WebGL the learning content and the panels still work @smoke', async ({ page }) => {
  const errors = await open(page, '?nowebgl');
  await expect(page.getByRole('heading', { name: '3D view unavailable' })).toBeVisible();
  await listButton(page, /^Stapes/).click();
  await expect(detailTitle(page)).toHaveText('Stapes (stirrup)');
  await page.keyboard.press('Escape');
  await mode(page, 'Hearing');
  await page.getByRole('button', { name: '4 kHz' }).click();
  await expect(page.locator('.hearing-panel [data-place]')).not.toHaveAttribute('data-place', '21.0');
  await mode(page, 'Balance');
  await page.getByRole('button', { name: /Turn left/ }).click();
  await expect.poll(() => num(page, '[data-canal="left-lateral"]', 'data-rate'), { timeout: 5_000, intervals: [50] }).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('a missing model shows an error with a working retry', async ({ page }) => {
  let fail = true;
  await page.route('**/models/ear.glb', (route) => (fail ? route.fulfill({ status: 404, body: 'not found' }) : route.continue()));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('The 3D model could not be loaded');
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await ready(page);
});

test('reduced motion: every simulation works without errors', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1366, height: 820 } });
  const page = await context.newPage();
  const errors = await open(page);
  await ready(page);
  await mode(page, 'Hearing');
  await settle(page, 800);
  await expect(page.locator('.bm-wave')).toBeVisible();
  await mode(page, 'Balance');
  await page.getByRole('button', { name: /Turn left/ }).click();
  await expect.poll(() => num(page, '[data-canal="left-lateral"]', 'data-rate'), { timeout: 5_000, intervals: [50] }).toBeGreaterThan(100);
  await mode(page, 'Close-ups');
  await radio(page, 'Cochlear duct').click();
  await settle(page, 800);
  await radio(page, 'BPPV').click();
  await page.getByRole('button', { name: 'Start →' }).click();
  await settle(page, 800);
  await mode(page, 'Clinic');
  await settle(page, 800);
  expect(errors).toEqual([]);
  await context.close();
});
