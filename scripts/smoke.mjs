import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

// Exercise the real API and built UI with isolated, disposable reference data.
const temp = await mkdtemp(join(tmpdir(), 'meltek-smoke-'));
const password = randomUUID();
Object.assign(process.env, { DATA_FILE: join(temp, 'data.json'), MYSQL_URL: '', DATABASE_URL: '', LOG_LEVEL: 'silent', MELTEK_ADMIN_EMAIL: 'smoke@example.test', MELTEK_ADMIN_PASSWORD: password });
const { createServer } = await import('../apps/api/dist/server.js');
const { app } = await createServer();
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1512, height: 1100 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', 'smoke@example.test');
  await page.type('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.studio-recommendation');
  await page.waitForFunction(() => document.querySelector('.studio-recommendation').textContent.includes('SWG'));
  assert.equal(await page.$eval('select[name=accuracyClass]', el => el.value), '0.5S');
  await page.screenshot({ path: join(temp, 'desktop.png'), fullPage: true });
  await page.click('button[aria-label="Switch to dark theme"]');
  await page.screenshot({ path: join(temp, 'desktop-dark.png'), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity));
  await page.screenshot({ path: join(temp, 'mobile.png'), fullPage: true });


  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows horizontally');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await page.$eval('.core-float', el => getComputedStyle(el).animationName), 'none');
  await page.$eval('input[name=maxWidthMm]', el => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '1'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.body.textContent.includes('No feasible combination'));
  assert(await page.$eval('button[type=submit]', el => el.disabled), 'Infeasible design should not be saved');
  assert((await page.$$('tbody tr')).length > 0, 'Rejection reasons must remain visible');
  await page.$eval('input[name=maxWidthMm]', el => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('input[name=customerName]', 'Smoke customer');
  await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname.startsWith('/designs/'));
  const saved = await page.evaluate(async () => (await fetch(`/api${location.pathname}`)).json());
  assert(saved.design.selectedOptionId, 'The recommended selection must survive saving');
  const rejected = saved.options.find(o => !o.isFeasible);
  assert(rejected, 'Smoke fixture must contain a rejected option');
  const rejectionStatus = await page.evaluate(async ({ id, optionId }) => (await fetch(`/api/designs/${id}/select`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId }) })).status, { id: saved.design.id, optionId: rejected.id });
  assert.equal(rejectionStatus, 409);
  assert.deepEqual(errors, []);
  console.log(`Browser smoke checks passed. Screenshots: ${temp}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
