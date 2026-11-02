import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBuild } from '../src/api.js';

const cliPath = fileURLToPath(new URL('../bin/zeropress-build.js', import.meta.url));
const themePath = fileURLToPath(new URL('./fixtures/golden-theme', import.meta.url));
const indexPath = '_zeropress/search.json';
async function data() {
  return JSON.parse(await fs.readFile(new URL('./fixtures/default-preview-data.json', import.meta.url)));
}
function cli(root, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ZEROPRESS_PUBLIC_DIR: path.join(root, 'public') },
  });
}
async function silentBuild(...args) {
  const printed = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  try {
    console.log = console.warn = (...values) => printed.push(values);
    const result = await runBuild(...args);
    assert.deepEqual(printed, []);
    return result;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

test('CLI/API skip option returns a single warning, keeps artifacts and succeeds', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-search-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previewData = await data();
  const source = path.join(root, 'data.json');
  await fs.writeFile(source, JSON.stringify(previewData));
  const result = await silentBuild(themePath, previewData, path.join(root, 'api'), {
    publicDir: path.join(root, 'public'), generateSearchIndex: false,
  });
  const { message, ...warning } = result.warnings[0];
  assert.deepEqual(warning, { code: 'NATIVE_SEARCH_INDEX_SKIPPED', reason: 'requested', recordCount: 4 });
  assert.equal(result.warnings.length, 1);
  const processResult = cli(root, themePath, '--data', source, '--out', 'cli', '--skip-search-index');
  assert.equal(processResult.status, 0, processResult.stderr);
  assert.equal(processResult.stderr, `[NATIVE_SEARCH_INDEX_SKIPPED] ${message}\n`);
  assert.match(processResult.stdout, /Built ZeroPress site successfully/);
  for (const name of [indexPath, '_zeropress/search.js', '_zeropress/search_pagefind.js', 'index.html']) {
    assert.equal(await fs.readFile(path.join(root, 'cli', name), 'utf8'), await fs.readFile(path.join(root, 'api', name), 'utf8'));
  }
  const items = JSON.parse(await fs.readFile(path.join(root, 'cli', indexPath)));
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'zeropress:search-omitted');
  assert.deepEqual(JSON.parse(await fs.readFile(source)), previewData);
});

test('default/true options generate the original index and automatic warnings reach the CLI', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-search-default-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previewData = await data();
  const source = path.join(root, 'data.json');
  await fs.writeFile(source, JSON.stringify(previewData));
  const normal = cli(root, themePath, '--data', source, '--out', 'normal');
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(normal.stderr, '');
  const explicitTrue = await silentBuild(themePath, previewData, path.join(root, 'explicit'), {
    publicDir: path.join(root, 'public'), generateSearchIndex: true,
  });
  assert.deepEqual(explicitTrue.warnings, []);
  assert.equal(await fs.readFile(path.join(root, 'normal', indexPath), 'utf8'), await fs.readFile(path.join(root, 'explicit', indexPath), 'utf8'));

  for (const [size, code, reason] of [
    [2, 'NATIVE_SEARCH_INDEX_LARGE', undefined],
    [5, 'NATIVE_SEARCH_INDEX_SKIPPED', 'size_limit'],
  ]) {
    previewData.content.posts[0].content = '<p>' + 'x'.repeat(size * 1024 * 1024) + '</p>';
    await fs.writeFile(source, JSON.stringify(previewData));
    const api = await silentBuild(themePath, previewData, path.join(root, `api-${size}`), { publicDir: path.join(root, 'public') });
    assert.equal(api.warnings.length, 1);
    assert.equal(api.warnings[0].code, code);
    assert.equal(api.warnings[0].reason, reason);
    const actual = cli(root, themePath, '--data', source, '--out', `cli-${size}`);
    assert.equal(actual.status, 0, actual.stderr);
    assert.equal(actual.stderr, `[${code}] ${api.warnings[0].message}\n`);
  }
});

test('CLI skip keeps a truly empty index quiet and leaves disabled search without artifacts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-search-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previewData = await data();
  previewData.content.posts = [];
  previewData.content.pages = [];
  const source = path.join(root, 'data.json');
  await fs.writeFile(source, JSON.stringify(previewData));
  const empty = cli(root, themePath, '--data', source, '--out', 'empty', '--skip-search-index');
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stderr, '');
  assert.equal(await fs.readFile(path.join(root, 'empty', indexPath), 'utf8'), '[]\n');
  previewData.site.search = { enabled: false };
  await fs.writeFile(source, JSON.stringify(previewData));
  const disabled = cli(root, themePath, '--data', source, '--out', 'disabled', '--skip-search-index');
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(disabled.stderr, '');
  await assert.rejects(fs.access(path.join(root, 'disabled', indexPath)), { code: 'ENOENT' });
});

test('skip option is documented, takes no value and does not bypass output/input protections', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-search-protection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const help = cli(root, '--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--skip-search-index/);
  assert.match(help.stdout, /2 MiB.*5 MiB.*5,000/);
  const source = path.join(root, 'data.json');
  const sourceText = JSON.stringify(await data());
  await fs.writeFile(source, sourceText);
  const invalid = cli(root, themePath, '--data', source, '--skip-search-index', 'false');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid arguments/);

  const output = path.join(root, 'dist');
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, 'previous.txt'), 'previous output');
  const nonempty = cli(root, themePath, '--data', source, '--out', 'dist', '--skip-search-index');
  assert.equal(nonempty.status, 1);
  assert.match(nonempty.stderr, /Output directory must be empty/);

  const publicIndex = path.join(root, 'public', indexPath);
  await fs.mkdir(path.dirname(publicIndex), { recursive: true });
  await fs.writeFile(publicIndex, 'public conflict');
  const conflict = cli(root, themePath, '--data', source, '--out', 'dist', '--skip-search-index', '--empty-out-dir');
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /Duplicate public URL detected: \/_zeropress\/search\.json/);
  assert.deepEqual(await fs.readdir(output), ['previous.txt']);
  assert.equal(await fs.readFile(path.join(output, 'previous.txt'), 'utf8'), 'previous output');
  assert.equal(await fs.readFile(source, 'utf8'), sourceText);
  assert.equal(await fs.readFile(publicIndex, 'utf8'), 'public conflict');
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith('.dist.zeropress-build-')), false);

  const protectedSource = path.join(output, 'data.json');
  await fs.writeFile(protectedSource, sourceText);
  const overlap = cli(root, themePath, '--data', protectedSource, '--out', 'dist', '--skip-search-index', '--empty-out-dir');
  assert.equal(overlap.status, 1);
  assert.match(overlap.stderr, /must not contain the preview-data file/);
  assert.equal(await fs.readFile(protectedSource, 'utf8'), sourceText);
  assert.equal(await fs.readFile(path.join(output, 'previous.txt'), 'utf8'), 'previous output');
});


test('skip option protects Preview Data reached through a symbolic-link alias', {
  skip: process.platform === 'win32' ? 'symlink creation may require privileges' : false,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-search-input-alias-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'dist');
  await fs.mkdir(output);
  const source = path.join(output, 'data.json');
  const sourceText = JSON.stringify(await data());
  await fs.writeFile(source, sourceText);
  const alias = path.join(root, 'input-alias.json');
  await fs.symlink(source, alias, 'file');
  const result = cli(root, themePath, '--data', alias, '--out', 'dist', '--skip-search-index', '--empty-out-dir');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not contain the preview-data file/);
  assert.equal(await fs.readFile(source, 'utf8'), sourceText);
  assert.equal(await fs.readFile(alias, 'utf8'), sourceText);
  assert.deepEqual(await fs.readdir(output), ['data.json']);
});
