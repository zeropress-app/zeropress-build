import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createObjectPreviewDataSource } from '@zeropress/preview-data-validator';
import { writePreviewDataChunks } from '@zeropress/preview-data-validator/node';
import { runBuild, runBuildFromSource, openPreviewDataSource } from '../src/api.js';
const theme = fileURLToPath(new URL('./fixtures/golden-theme', import.meta.url));
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-chunks-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const data = JSON.parse(await fs.readFile(new URL('./fixtures/default-preview-data.json', import.meta.url)));
  const file = path.join(dir, 'data.manifest.json');
  await writePreviewDataChunks(createObjectPreviewDataSource(data), file, { targetBytes: 700 });
  return { dir, data, file };
}
async function snapshot(dir) {
  const files = (await fs.readdir(dir, { recursive: true })).sort(), values = {};
  for (const file of files) if ((await fs.stat(path.join(dir, file))).isFile()) values[file] = await fs.readFile(path.join(dir, file));
  return values;
}
test('source API and CLI preserve object output, warnings, and input files', async t => {
  const { dir, data, file } = await fixture(t), source = await openPreviewDataSource(file);
  const before = await fs.readFile(file);
  try {
    const options = { publicDir: path.join(dir, 'public'), generateSearchIndex: false };
    const expected = await runBuild(theme, data, path.join(dir, 'legacy'), options);
    assert.deepEqual(await runBuildFromSource(theme, source, path.join(dir, 'chunks'), options), expected);
    assert.deepEqual(await snapshot(path.join(dir, 'legacy')), await snapshot(path.join(dir, 'chunks')));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/zeropress-build.js', import.meta.url)), theme, '--data', file, '--out', 'cli', '--skip-search-index'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.match(/NATIVE_SEARCH_INDEX_SKIPPED/g)?.length, 1);
    assert.deepEqual(await snapshot(path.join(dir, 'cli')), await snapshot(path.join(dir, 'chunks')));
    assert.deepEqual(await fs.readFile(file), before);
  } finally { await source.close(); }
});
test('late chunk corruption preserves old output and removes staging directories', async t => {
  const { dir, file } = await fixture(t), source = await openPreviewDataSource(file);
  const out = path.join(dir, 'dist'); await fs.mkdir(out); await fs.writeFile(path.join(out, 'previous.txt'), 'previous');
  const last = source.inputPaths.at(-1); await fs.appendFile(last, ' ');
  try {
    await assert.rejects(() => runBuildFromSource(theme, source, out, { publicDir: path.join(dir, 'public'), projectRoot: dir, emptyOutDir: true }), /mismatch/);
    assert.deepEqual(Object.keys(await snapshot(out)), ['previous.txt']);
    assert.equal((await fs.readdir(dir)).filter(p => p.includes('stage')).length, 0);
  } finally { await source.close(); }
});
test('source protects generation roots and hard links from output/public placement', async t => {
  const { dir, file } = await fixture(t), source = await openPreviewDataSource(file);
  try {
    await assert.rejects(() => runBuildFromSource(theme, source, path.join(source.inputRoots[0], 'dist'), { publicDir: path.join(dir, 'public') }), /overlap/);
    const publicDir = path.join(dir, 'public'); await fs.mkdir(publicDir);
    await fs.link(source.inputPaths.at(-1), path.join(publicDir, 'private.json'));
    await assert.rejects(() => runBuildFromSource(theme, source, path.join(dir, 'dist'), { publicDir }), /hard-link/);
    await fs.rm(path.join(publicDir, 'private.json'));
    await fs.symlink(source.inputRoots[0], path.join(dir, 'alias'));
    await assert.rejects(() => runBuildFromSource(theme, source, path.join(dir, 'alias/dist'), { publicDir }), /overlap/);
  } finally { await source.close(); }
});


test('a single 5 MiB body builds completely while native indexing is omitted for all input forms', async t => {
  const { dir, data, file } = await fixture(t);
  const bytes = 5 * 1024 * 1024;
  const content = '<p>' + 'x'.repeat(bytes - 7) + '</p>';
  assert.equal(Buffer.byteLength(content, 'utf8'), bytes);
  data.content.posts = [{ ...data.content.posts[0], document_type: 'html', content }];
  data.content.pages = [];
  await writePreviewDataChunks(createObjectPreviewDataSource(data), file);
  const json = path.join(dir, 'data.json');
  const originalJson = JSON.stringify(data);
  await fs.writeFile(json, originalJson);
  // Leave both body size and search options omitted: no body ceiling, but
  // automatic native-index limits still apply to this one large document.
  const options = { publicDir: path.join(dir, 'public') };
  const result = await runBuild(theme, data, path.join(dir, 'object'), options);
  assert.deepEqual(result.warnings.map(w => w.code).sort(), ['CONTENT_BODY_LARGE', 'NATIVE_SEARCH_INDEX_SKIPPED']);
  const bodyWarning = result.warnings.find(w => w.code === 'CONTENT_BODY_LARGE');
  assert.equal(bodyWarning.count, 1);
  assert.equal(bodyWarning.maxBodyBytes, bytes);
  const searchWarning = result.warnings.find(w => w.code === 'NATIVE_SEARCH_INDEX_SKIPPED');
  assert.equal(searchWarning.reason, 'size_limit');
  assert.equal(searchWarning.recordCount, 1);
  const expected = await snapshot(path.join(dir, 'object'));
  assert.ok(expected[`posts/${data.content.posts[0].slug}/index.html`].toString('utf8').includes(content));
  const index = JSON.parse(expected['_zeropress/search.json']);
  assert.equal(index.length, 1);
  assert.equal(index[0].id, 'zeropress:search-omitted');
  for (const adapter of ['_zeropress/search.js', '_zeropress/search_pagefind.js']) assert.ok(expected[adapter]);
  const source = await openPreviewDataSource(file);
  const originalInputs = new Map(await Promise.all(source.inputPaths.map(async input => [input, await fs.readFile(input)])));
  try {
    assert.deepEqual(await runBuildFromSource(theme, source, path.join(dir, 'source'), options), result);
    assert.deepEqual(await snapshot(path.join(dir, 'source')), expected);
    for (const [i, input] of [json, file].entries()) {
      const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/zeropress-build.js', import.meta.url)), theme, '--data', input, '--out', `cli-${i}`], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ZEROPRESS_PUBLIC_DIR: options.publicDir },
      });
      assert.equal(cli.status, 0, cli.stderr);
      assert.equal(cli.stderr, result.warnings.map(w => `[${w.code}] ${w.message}\n`).join(''));
      assert.deepEqual(await snapshot(path.join(dir, `cli-${i}`)), expected);
    }
    for (const [input, original] of originalInputs) assert.deepEqual(await fs.readFile(input), original);
  } finally { await source.close(); }
  assert.equal(await fs.readFile(json, 'utf8'), originalJson);
  assert.equal(JSON.stringify(data), originalJson);
});
