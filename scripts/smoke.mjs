import { mkdtemp, readdir, readFile } from 'node:fs/promises';
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
  browser = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
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
  await page.waitForSelector('.model-stage[data-model-ready="true"]');
  assert(await page.evaluate(() => document.querySelector('.parameter-grid').getBoundingClientRect().bottom < document.querySelector('#design-guidance').getBoundingClientRect().top), 'Inputs must precede guidance');
  const preview = await page.$('.design-views');
  await preview.screenshot({ path: join(temp, 'selected-design.png') });
  const selectedBefore = await page.$eval('.design-views', el => el.dataset.selectedModel);
  await page.click('tbody tr:nth-child(2)');
  await page.waitForFunction(key => document.querySelector('.design-views')?.dataset.selectedModel !== key, {}, selectedBefore);
  const selectedAfter = await page.$eval('.design-views', el => el.dataset.selectedModel);
  const diagramAfter = await page.$eval('.drawing-stage svg', el => el.getAttribute('aria-label'));
  assert(diagramAfter.includes('ordered width 35'), 'Diagram must follow the selected slit width');
  const clickText = async text => {
    const buttons = await page.$$('button');
    for (const button of buttons) if ((await button.evaluate(el => el.textContent)).trim() === text) { await button.click(); return; }
    throw new Error(`Missing button: ${text}`);
  };
  const modelCanvas = await page.$('.model-stage canvas');
  const beforeRotation = await modelCanvas.screenshot();
  await clickText('Rotate left');
  const afterRotation = await modelCanvas.screenshot();
  assert.notDeepEqual(beforeRotation, afterRotation, 'Rotation should change the rendered 3D view');
  await clickText('Reset view');
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: temp });
  await clickText('Export core STL');
  await clickText('Download SVG');
  let files = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    files = await readdir(temp);
    if (files.some(f => f.endsWith('.stl')) && files.some(f => f.endsWith('.svg'))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const stlName = files.find(f => f.endsWith('.stl'));
  assert(stlName, 'Core STL should download');
  const stl = await readFile(join(temp, stlName), 'utf8');
  const vertices = [...stl.matchAll(/vertex\s+([-\deE+.]+)\s+([-\deE+.]+)\s+([-\deE+.]+)/g)].map(m => m.slice(1).map(Number));
  const xs = vertices.map(v => v[0]); const zs = vertices.map(v => v[2]);
  assert(Math.abs(Math.max(...xs) - Math.min(...xs) - 63) < .001, 'STL OD must be 63 mm');
  assert(Math.abs(Math.max(...zs) - Math.min(...zs) - 35) < .001, 'STL width must be 35 mm for the selected option');
  assert(files.some(f => f.endsWith('.svg')), 'Diagram SVG should download');
  await page.mouse.move(600, 100);
  await page.waitForSelector('aside[data-expanded="false"]');
  await page.hover('aside');
  await page.waitForSelector('aside[data-expanded="true"]');
  await page.goto(`${url}/admin?tab=grades`, { waitUntil: 'networkidle0' });
  await page.hover('aside');
  for (const tab of ['grades', 'gauges', 'dies', 'rates', 'customers', 'accounts', 'settings']) {
    await page.click(`aside a[href="/admin?tab=${tab}"]`);
    await page.waitForFunction(t => new URL(location.href).searchParams.get('tab') === t && !!document.querySelector('.reference-tabs button[aria-current="page"]'), {}, tab);
    assert.equal(await page.$eval(`aside a[href="/admin?tab=${tab}"]`, el => el.getAttribute('aria-current')), 'page');
  }
  await page.goBack({ waitUntil: 'networkidle0' });
  assert(new URL(page.url()).searchParams.get('tab') === 'accounts', 'Back should restore the previous tab');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('.reference-tabs button[aria-current="page"]', el => el.textContent.trim()), 'Accounts');
  await page.mouse.move(600, 100);
  await page.waitForSelector('aside[data-expanded="false"]');
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.model-stage[data-model-ready="true"]');
  console.log(`Selection changed from ${selectedBefore} to ${selectedAfter}; model, downloads and navigation verified.`);
  assert.equal(await page.$eval('select[name=accuracyClass]' , el => el.value), '0.5S');
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
