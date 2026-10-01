import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBuild } from '../src/index.js';

test('programmatic builds return warnings silently and CLI builds print them once to stderr', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-menu-warning-'));
  try {
    const theme = path.join(root, 'theme');
    await fs.cp(new URL('./fixtures/golden-theme/', import.meta.url), theme, { recursive: true });
    const manifestPath = path.join(theme, 'theme.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.menu_slots = { primary: { title: 'Primary', max_depth: 1 } };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const data = JSON.parse(await fs.readFile(new URL('./fixtures/default-preview-data.json', import.meta.url)));
    data.menus.primary.items = [{ title: 'Parent', url: '/', target: '_self', children: [{ title: 'Child', url: '/child/', target: '_self', children: [] }] }];
    const dataPath = path.join(root, 'data.json');
    await fs.writeFile(dataPath, JSON.stringify(data));
    const printed = [];
    const originalWarn = console.warn;
    const originalLog = console.log;
    let result;
    try {
      console.warn = console.log = (...args) => printed.push(args);
      result = await runBuild(theme, data, path.join(root, 'api'), { projectRoot: root });
    } finally {
      console.warn = originalWarn;
      console.log = originalLog;
    }
    assert.deepEqual(printed, []);
    assert.equal(result.warnings.length, 1);
    assert.deepEqual({ ...result.warnings[0], message: undefined }, {
      code: 'MENU_MAX_DEPTH_EXCEEDED', menuId: 'primary', maxDepth: 1,
      actualDepth: 2, omittedItems: 1, message: undefined,
    });
    const cli = spawnSync(process.execPath, [
      fileURLToPath(new URL('../bin/zeropress-build.js', import.meta.url)),
      theme, '--data', dataPath, '--out', 'cli',
    ], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stderr.trim(), `[${result.warnings[0].code}] ${result.warnings[0].message}`);
    assert.match(cli.stdout, /Built ZeroPress site successfully/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
