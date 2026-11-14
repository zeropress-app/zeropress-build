import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createObjectPreviewDataSource } from '@zeropress/preview-data-validator';
import { writePreviewDataChunks } from '@zeropress/preview-data-validator/node';
import { runBuild, runBuildFromSource, openPreviewDataSource } from '../src/api.js';

const cli = fileURLToPath(new URL('../bin/zeropress-build.js', import.meta.url));
const theme = fileURLToPath(new URL('./fixtures/golden-theme', import.meta.url));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const invoke = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'data-image-cli-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const data = JSON.parse(await fs.readFile(new URL('./fixtures/default-preview-data.json', import.meta.url)));
  data.content.pages[0].content = `<img src="${png}" alt="valid"><img src="data:image/png;base64,AAAA" alt="invalid">`;
  const json = path.join(dir, 'data.json'), manifest = path.join(dir, 'data.manifest.json');
  await fs.writeFile(json, JSON.stringify(data));
  await writePreviewDataChunks(createObjectPreviewDataSource(data), manifest, { targetBytes: 1000 });
  return { dir, data, json, manifest };
}

test('CLI, object and chunk APIs share opt-in output; WXR-style default stays quiet', async t => {
  const { dir, data, json, manifest } = await fixture(t);
  const options = { publicDir: path.join(dir, 'public'), allowDataUriImages: true };
  const output = path.join(dir, 'api');
  const printed = [], oldWarn = console.warn, oldLog = console.log;
  let result;
  try {
    console.warn = console.log = (...args) => printed.push(args);
    result = await runBuild(theme, data, output, options);
  } finally { console.warn = oldWarn; console.log = oldLog; }
  assert.deepEqual(printed, []);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'DATA_URI_IMAGES_REMOVED');
  assert.equal(result.warnings[0].count, 1);
  const expected = await fs.readFile(path.join(output, 'about/index.html'), 'utf8');
  assert.ok(expected.includes(png));
  for (const [i, input] of [json, manifest].entries()) {
    const normal = invoke(dir, theme, '--data', input, '--out', `normal-${i}`);
    assert.equal(normal.status, 0, normal.stderr);
    assert.equal(normal.stderr, '');
    assert.ok(!(await fs.readFile(path.join(dir, `normal-${i}/about/index.html`), 'utf8')).includes(png));
    const enabled = invoke(dir, theme, '--data', input, '--out', `enabled-${i}`, '--allow-data-uri-images');
    assert.equal(enabled.status, 0, enabled.stderr);
    assert.equal(enabled.stderr, `[DATA_URI_IMAGES_REMOVED] ${result.warnings[0].message}\n`);
    assert.equal(await fs.readFile(path.join(dir, `enabled-${i}/about/index.html`), 'utf8'), expected);
    assert.doesNotMatch(enabled.stderr, /iVBOR|AAAA/);
  }
  const source = await openPreviewDataSource(manifest);
  try {
    const actual = await runBuildFromSource(theme, source, path.join(dir, 'source'), options);
    assert.deepEqual(actual, result);
  } finally { await source.close(); }
  assert.deepEqual(JSON.parse(await fs.readFile(json)), data);
});

test('flag is valueless and does not bypass body, output replacement or input path checks', async t => {
  const { dir, data, json } = await fixture(t);
  assert.match(invoke(dir, '--help').stdout, /--allow-data-uri-images/);
  assert.equal(invoke(dir, theme, '--data', json, '--allow-data-uri-images', 'false').status, 1);
  const out = path.join(dir, 'dist'); await fs.mkdir(out); await fs.writeFile(path.join(out, 'keep.txt'), 'previous');
  const nonempty = invoke(dir, theme, '--data', json, '--out', 'dist', '--allow-data-uri-images');
  assert.match(nonempty.stderr, /must be empty/);
  const tooLarge = invoke(dir, theme, '--data', json, '--out', 'dist', '--empty-out-dir', '--allow-data-uri-images', '--max-body-bytes', '32');
  assert.match(tooLarge.stderr, /CONTENT_BODY_TOO_LARGE/);
  for (const allowDataUriImages of [null, 0, 'true']) {
    await assert.rejects(() => runBuild(theme, data, out, { allowDataUriImages }), /allowDataUriImages must be a boolean/);
  }
  await fs.copyFile(json, path.join(out, 'data.json'));
  const overlap = invoke(dir, theme, '--data', path.join(out, 'data.json'), '--out', 'dist', '--empty-out-dir', '--allow-data-uri-images');
  assert.match(overlap.stderr, /must not contain the preview-data file/);
  assert.equal(await fs.readFile(path.join(out, 'keep.txt'), 'utf8'), 'previous');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, 'data.json'))), data);
});
