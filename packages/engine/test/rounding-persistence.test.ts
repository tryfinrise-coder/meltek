import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { JsonStore } from '../../../apps/api/src/store/json-store';

it('adds the setting to an older database and retains the user percentage after restart', async () => {
  const file = join(tmpdir(), `meltek-rounding-${randomUUID()}.json`);
  let store: JsonStore | undefined;
  try {
    store = new JsonStore(file);
    await store.init();
    await store.close();
    const old = JSON.parse(await readFile(file, 'utf8'));
    old.settings = old.settings.filter((row: {key: string}) => row.key !== 'coreWidthRoundingTolerancePercent');
    await writeFile(file, JSON.stringify(old), 'utf8');
    store = new JsonStore(file);
    await store.init();
    expect((await store.getSettings()).coreWidthRoundingTolerancePercent).toBe(1);
    await store.saveSetting('coreWidthRoundingTolerancePercent', 5, 'rounding-test');
    await store.close();
    store = new JsonStore(file);
    await store.init();
    expect((await store.getSettings()).coreWidthRoundingTolerancePercent).toBe(5);
    expect((await store.getSettingRows()).find(row=>row.key==='coreWidthRoundingTolerancePercent')?.updatedBy).toBe('rounding-test');
  } finally {
    await store?.close();
    await unlink(file).catch(()=>undefined);
  }
});
