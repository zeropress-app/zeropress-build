import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const goldenThemeDir = path.join(fixturesDir, 'golden-theme');
const defaultPreviewDataPath = path.join(fixturesDir, 'default-preview-data.json');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

async function captureLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await fn();
    return logs;
  } finally {
    console.log = originalLog;
  }
}

test('run prints help with no args', async () => {
  const logs = await captureLogs(() => run([]));
  assert.equal(logs.some((line) => line.includes('Usage:')), true);
  assert.equal(logs.some((line) => line.includes('zeropress-build <themeDir> --data <path> [--out <dir>]')), true);
  assert.equal(logs.some((line) => line.includes('Canonical preview-data v0.5 JSON file')), true);
  assert.equal(logs.some((line) => line.includes('selective or patch build is not supported')), true);
});

test('run prints version', async () => {
  const logs = await captureLogs(() => run(['--version']));
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  assert.deepEqual(logs, [pkg.version]);
});

test('run prints version with -v', async () => {
  const logs = await captureLogs(() => run(['-v']));
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  assert.deepEqual(logs, [pkg.version]);
});

test('run rejects missing args', async () => {
  await assert.rejects(
    () => run([goldenThemeDir]),
    /Invalid arguments: --data <path> is required/
  );
});

test('run rejects nonexistent theme directory', async () => {
  await assert.rejects(
    () => run(['./does-not-exist-theme', '--data', defaultPreviewDataPath]),
    /Theme directory not found:/
  );
});

test('run rejects nonexistent preview-data file', async () => {
  await assert.rejects(
    () => run([goldenThemeDir, '--data', './does-not-exist-preview.json']),
    /Preview-data file not found:/
  );
});

test('run rejects invalid preview-data JSON', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const invalidJsonPath = path.join(tempDir, 'invalid.json');

  try {
    await fs.writeFile(invalidJsonPath, '{"broken":', 'utf8');
    await assert.rejects(
      () => run([goldenThemeDir, '--data', invalidJsonPath]),
      /Invalid preview-data JSON:/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects preview-data that fails validation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const invalidPreviewPath = path.join(tempDir, 'preview.json');

  try {
    await fs.writeFile(invalidPreviewPath, JSON.stringify({ version: '0.3' }), 'utf8');
    await assert.rejects(
      () => run([goldenThemeDir, '--data', invalidPreviewPath]),
      /Invalid preview-data:/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run writes a full build to default ./dist when outDir is omitted', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    const logs = await captureLogs(() => run([goldenThemeDir, '--data', defaultPreviewDataPath]));
    const distDir = path.join(tempDir, 'dist');

    await fs.access(path.join(distDir, 'index.html'));
    await fs.access(path.join(distDir, 'sitemap.xml'));
    await fs.access(path.join(distDir, 'feed.xml'));
    await fs.access(path.join(distDir, 'robots.txt'));
    await fs.access(path.join(distDir, 'meta.json'));
    await fs.access(path.join(distDir, 'posts', 'hello-zeropress', 'index.html'));
    await fs.access(path.join(distDir, 'about', 'index.html'));

    const distEntries = await fs.readdir(path.join(distDir, 'assets'));
    assert.equal(distEntries.some((entry) => /^style\.[a-f0-9]{8}\.css$/.test(entry)), true);
    assert.equal(logs.some((line) => line.includes('Built ZeroPress site successfully')), true);
    assert.equal(
      logs.some((line) => line.startsWith('Output: ') && line.endsWith(`${path.sep}dist`)),
      true,
    );
    assert.equal(logs.some((line) => line.startsWith('Files: ')), true);
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run writes a full build to an explicit outDir', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const outDir = path.join(tempDir, 'site-output');

  try {
    await run([goldenThemeDir, '--data', defaultPreviewDataPath, '--out', outDir]);
    await fs.access(path.join(outDir, 'index.html'));
    await fs.access(path.join(outDir, 'archive', 'index.html'));
    await fs.access(path.join(outDir, 'categories', 'general', 'index.html'));
    await fs.access(path.join(outDir, 'tags', 'intro', 'index.html'));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects a non-empty output directory', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const outDir = path.join(tempDir, 'site-output');

  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'existing.txt'), 'already here', 'utf8');

    await assert.rejects(
      () => run([goldenThemeDir, '--data', defaultPreviewDataPath, '--out', outDir]),
      /Output directory must be empty:/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
