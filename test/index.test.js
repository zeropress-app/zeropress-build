import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as packageApi from '@zeropress/build';
import { formatBuildSuccessMessage, run, runBuild } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const goldenThemeDir = path.join(fixturesDir, 'golden-theme');
const defaultPreviewDataPath = path.join(fixturesDir, 'default-preview-data.json');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

test('package root exports the programmatic build API', () => {
  assert.deepEqual(Object.keys(packageApi), ['runBuild']);
  assert.equal(packageApi.runBuild, runBuild);
});

function withPublicDirEnv(value, fn) {
  const previousValue = process.env.ZEROPRESS_PUBLIC_DIR;
  if (value === undefined) {
    delete process.env.ZEROPRESS_PUBLIC_DIR;
  } else {
    process.env.ZEROPRESS_PUBLIC_DIR = value;
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousValue === undefined) {
        delete process.env.ZEROPRESS_PUBLIC_DIR;
      } else {
        process.env.ZEROPRESS_PUBLIC_DIR = previousValue;
      }
    });
}

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

async function captureRejectMessage(fn) {
  try {
    await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  assert.fail('Expected function to reject');
}

function withColorEnv(env, fn) {
  const previousForceColor = process.env.FORCE_COLOR;
  const previousNoColor = process.env.NO_COLOR;

  if ('FORCE_COLOR' in env) {
    process.env.FORCE_COLOR = env.FORCE_COLOR;
  } else {
    delete process.env.FORCE_COLOR;
  }

  if ('NO_COLOR' in env) {
    process.env.NO_COLOR = env.NO_COLOR;
  } else {
    delete process.env.NO_COLOR;
  }

  try {
    return fn();
  } finally {
    if (previousForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = previousForceColor;
    }

    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  }
}

test('formatBuildSuccessMessage uses success color when color is enabled', () => {
  const message = withColorEnv({ FORCE_COLOR: '1' }, () => (
    formatBuildSuccessMessage({ isTTY: false })
  ));

  assert.equal(message, '\x1b[32mBuilt ZeroPress site successfully\x1b[0m');
});

test('run prints help with no args', async () => {
  const logs = await captureLogs(() => run([]));
  assert.equal(logs.some((line) => line.includes('Usage:')), true);
  assert.equal(
    logs.some((line) => line.includes(
      'zeropress-build <themeDir> --data <path> [--out <dir>] [--public-dir <dir>] [--empty-out-dir]',
    )),
    true,
  );
  assert.equal(logs.some((line) => line.includes('Canonical preview-data v0.7 JSON file')), true);
  assert.equal(logs.some((line) => line.includes('Public passthrough directory')), true);
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
    await fs.writeFile(invalidJsonPath, '{\n  "broken":\n', 'utf8');
    const message = await captureRejectMessage(() => run([goldenThemeDir, '--data', invalidJsonPath]));
    assert.match(message, /Invalid preview-data JSON/);
    assert.match(message, /File: .*invalid\.json/);
    assert.match(message, /Line: 3, Column: 1/);
    assert.match(message, /Category: json_syntax/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects preview-data that fails validation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const invalidPreviewPath = path.join(tempDir, 'preview.json');

  try {
    const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));
    previewData.version = '0.3';
    await fs.writeFile(invalidPreviewPath, JSON.stringify(previewData, null, 2), 'utf8');
    const message = await captureRejectMessage(() => run([goldenThemeDir, '--data', invalidPreviewPath]));
    assert.match(message, /Preview-data validation failed/);
    assert.match(message, /Path: version/);
    assert.match(message, /Category: preview_data_validation/);
    assert.match(message, /Code: INVALID_VERSION/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run reports preview-data validation path locations and hints', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const invalidPreviewPath = path.join(tempDir, 'preview.json');

  try {
    const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));
    previewData.menus.primary.items[0].url = 'not a url';
    await fs.writeFile(invalidPreviewPath, JSON.stringify(previewData, null, 2), 'utf8');

    const message = await captureRejectMessage(() => run([goldenThemeDir, '--data', invalidPreviewPath]));
    assert.match(message, /Preview-data validation failed/);
    assert.match(message, /Path: menus\.primary\.items\[0\]\.url/);
    assert.match(message, /Line: \d+, Column: \d+/);
    assert.match(message, /Category: preview_data_validation/);
    assert.match(message, /Code: INVALID_MENU_ITEM_URL/);
    assert.match(message, /Hint:\nUse an absolute URL/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run reports theme validation locations and script partial hints', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const themeDir = path.join(tempDir, 'theme');

  try {
    await fs.cp(goldenThemeDir, themeDir, { recursive: true });
    await fs.writeFile(path.join(themeDir, 'layout.html'), [
      '<html>',
      '<body>',
      '<main>{{slot:content}}</main>',
      '<script>alert(1)</script>',
      '</body>',
      '</html>',
    ].join('\n'), 'utf8');

    const message = await captureRejectMessage(() => run([themeDir, '--data', defaultPreviewDataPath]));
    assert.match(message, /Theme validation failed/);
    assert.match(message, /File: layout\.html/);
    assert.match(message, /Line: 4, Column: 1/);
    assert.match(message, /Category: theme_validation/);
    assert.match(message, /ERROR LAYOUT_SCRIPT_NOT_ALLOWED/);
    assert.match(message, /4 \| <script>alert\(1\)<\/script>/);
    assert.match(message, /partial:content-enhancements/);
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

test('runBuild forwards generateFeed option to build-core', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const outDir = path.join(tempDir, 'site-output');
  const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));

  try {
    await runBuild(goldenThemeDir, previewData, outDir, { generateFeed: false });
    await fs.access(path.join(outDir, 'index.html'));
    await fs.access(path.join(outDir, 'sitemap.xml'));
    await assert.rejects(() => fs.access(path.join(outDir, 'feed.xml')));
    await fs.access(path.join(outDir, 'robots.txt'));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run copies non-conflicting cwd public files after generated output succeeds', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'public', 'vendor'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'public', 'docs'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'public', 'favicon.ico'), 'icon', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'favicon.dark.ico'), 'dark icon', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'favicon.svg'), '<svg></svg>', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'favicon.png'), 'png', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'apple-touch-icon.png'), 'apple', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'sitemap.xsl'), '<xsl:stylesheet version="1.0"></xsl:stylesheet>', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'vendor', 'app.js'), 'console.log("public")', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'docs', 'foo.md'), '# Foo', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'robots.txt'), 'User-agent: *\nDisallow: /\n\nUser-agent: Cloudflare-AI-Search\nAllow: /\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'landing.html'), '<h1>Public landing</h1>', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'about-public.txt'), 'Public about file', 'utf8');
    await fs.mkdir(path.join(tempDir, 'public', '.git'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'public', '.vscode'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'public', 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'public', '.env'), 'secret', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', '.DS_Store'), 'metadata', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', '.git', 'config'), 'git config', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', '.vscode', 'settings.json'), '{}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'node_modules', 'x.js'), 'module', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'Thumbs.db'), 'thumbs', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'private.key'), 'key', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'cert.PEM'), 'pem', 'utf8');

    await run([goldenThemeDir, '--data', defaultPreviewDataPath]);

    const distDir = path.join(tempDir, 'dist');
    const generatedIndex = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
    const generatedAbout = await fs.readFile(path.join(distDir, 'about', 'index.html'), 'utf8');

    assert.equal(await fs.readFile(path.join(distDir, 'favicon.ico'), 'utf8'), 'icon');
    assert.equal(await fs.readFile(path.join(distDir, 'favicon.dark.ico'), 'utf8'), 'dark icon');
    assert.equal(await fs.readFile(path.join(distDir, 'favicon.svg'), 'utf8'), '<svg></svg>');
    assert.equal(await fs.readFile(path.join(distDir, 'favicon.png'), 'utf8'), 'png');
    assert.equal(await fs.readFile(path.join(distDir, 'apple-touch-icon.png'), 'utf8'), 'apple');
    assert.equal(await fs.readFile(path.join(distDir, 'sitemap.xsl'), 'utf8'), '<xsl:stylesheet version="1.0"></xsl:stylesheet>');
    assert.equal(await fs.readFile(path.join(distDir, 'vendor', 'app.js'), 'utf8'), 'console.log("public")');
    assert.equal(await fs.readFile(path.join(distDir, 'docs', 'foo.md'), 'utf8'), '# Foo');
    assert.equal(await fs.readFile(path.join(distDir, 'landing.html'), 'utf8'), '<h1>Public landing</h1>');
    assert.equal(await fs.readFile(path.join(distDir, 'about-public.txt'), 'utf8'), 'Public about file');
    assert.equal(await fs.readFile(path.join(distDir, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n\nUser-agent: Cloudflare-AI-Search\nAllow: /\n');
    assert.match(generatedIndex, /ZeroPress Preview/);
    assert.match(generatedIndex, /<link rel="icon" href="\/favicon\.ico" media="\(prefers-color-scheme: light\)">/);
    assert.match(generatedIndex, /<link rel="icon" href="\/favicon\.dark\.ico" media="\(prefers-color-scheme: dark\)">/);
    assert.match(generatedIndex, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" media="\(prefers-color-scheme: light\)">/);
    assert.match(generatedIndex, /<link rel="icon" href="\/favicon\.png" type="image\/png" media="\(prefers-color-scheme: light\)">/);
    assert.match(generatedIndex, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
    assert.match(
      await fs.readFile(path.join(distDir, 'sitemap.xml'), 'utf8'),
      /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<\?xml-stylesheet type="text\/xsl" href="\/sitemap\.xsl"\?>\n<urlset/,
    );
    assert.match(generatedAbout, /About/);
    await assert.rejects(() => fs.access(path.join(distDir, '.env')));
    await assert.rejects(() => fs.access(path.join(distDir, '.DS_Store')));
    await assert.rejects(() => fs.access(path.join(distDir, '.git', 'config')));
    await assert.rejects(() => fs.access(path.join(distDir, '.vscode', 'settings.json')));
    await assert.rejects(() => fs.access(path.join(distDir, 'node_modules', 'x.js')));
    await assert.rejects(() => fs.access(path.join(distDir, 'Thumbs.db')));
    await assert.rejects(() => fs.access(path.join(distDir, 'private.key')));
    await assert.rejects(() => fs.access(path.join(distDir, 'cert.PEM')));
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('runBuild rejects public files that collide with generated output before writing', async () => {
  const basePreviewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));
  const cases = [
    {
      name: 'directory route output',
      publicPath: 'about/index.html',
      mutate() {},
    },
    {
      name: 'directory route clean html alias',
      publicPath: 'about.html',
      mutate() {},
    },
    {
      name: 'html-extension route output',
      publicPath: 'about.html',
      mutate(previewData) {
        previewData.site.permalinks = {
          output_style: 'html-extension',
          posts: '/posts/:slug/',
          pages: '/:slug/',
          categories: '/categories/:slug/',
          tags: '/tags/:slug/',
        };
      },
    },
    {
      name: 'html-extension route clean index alias',
      publicPath: 'about/index.html',
      mutate(previewData) {
        previewData.site.permalinks = {
          output_style: 'html-extension',
          posts: '/posts/:slug/',
          pages: '/:slug/',
          categories: '/categories/:slug/',
          tags: '/tags/:slug/',
        };
      },
    },
    {
      name: 'dotted route public URL',
      publicPath: 'favicon.ico',
      mutate(previewData) {
        previewData.content.pages[0].slug = 'favicon.ico';
      },
    },
  ];

  for (const testCase of cases) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-public-collision-'));
    const publicDir = path.join(tempDir, 'public');
    const outDir = path.join(tempDir, 'dist');
    const previewData = structuredClone(basePreviewData);
    testCase.mutate(previewData);
    await fs.mkdir(path.dirname(path.join(publicDir, testCase.publicPath)), { recursive: true });
    await fs.writeFile(path.join(publicDir, testCase.publicPath), 'public', 'utf8');

    try {
      await assert.rejects(
        () => runBuild(goldenThemeDir, previewData, outDir, { publicDir }),
        /Duplicate (?:output path|public URL) detected:/,
        testCase.name,
      );
      await assert.rejects(fs.access(outDir), { code: 'ENOENT' });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

test('runBuild rejects a directory route shadowed by the generated 404 clean URL', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-special-file-collision-'));
  const outDir = path.join(tempDir, 'dist');
  const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));
  previewData.content.pages[0].slug = '404';

  try {
    await assert.rejects(
      () => runBuild(goldenThemeDir, previewData, outDir),
      /Duplicate public URL detected: \/404/,
    );
    await assert.rejects(fs.access(outDir), { code: 'ENOENT' });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run copies ZEROPRESS_PUBLIC_DIR files after generated output succeeds', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'docs', 'schemas'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'docs', 'schemas', 'preview-data.json'), '{}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'docs', 'source.md'), '# Source', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'ignored.txt'), 'ignored', 'utf8');

    await withPublicDirEnv('docs', () => run([goldenThemeDir, '--data', defaultPreviewDataPath]));

    const distDir = path.join(tempDir, 'dist');
    assert.equal(await fs.readFile(path.join(distDir, 'schemas', 'preview-data.json'), 'utf8'), '{}');
    assert.equal(await fs.readFile(path.join(distDir, 'source.md'), 'utf8'), '# Source');
    await assert.rejects(() => fs.access(path.join(distDir, 'ignored.txt')));
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run copies --public-dir files and prefers it over ZEROPRESS_PUBLIC_DIR', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'docs', 'schemas'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'docs', 'favicon.ico'), 'icon', 'utf8');
    await fs.writeFile(path.join(tempDir, 'docs', 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'docs', 'schemas', 'preview-data.json'), '{}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'docs', 'source.md'), '# Source', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'ignored.txt'), 'ignored', 'utf8');

    await withPublicDirEnv('public', () => run([goldenThemeDir, '--data', defaultPreviewDataPath, '--public-dir', 'docs']));

    const distDir = path.join(tempDir, 'dist');
    const indexHtml = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
    assert.equal(await fs.readFile(path.join(distDir, 'favicon.ico'), 'utf8'), 'icon');
    assert.equal(await fs.readFile(path.join(distDir, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
    assert.match(indexHtml, /<link rel="icon" href="\/favicon\.ico">/);
    assert.equal(await fs.readFile(path.join(distDir, 'schemas', 'preview-data.json'), 'utf8'), '{}');
    assert.equal(await fs.readFile(path.join(distDir, 'source.md'), 'utf8'), '# Source');
    await assert.rejects(() => fs.access(path.join(distDir, 'ignored.txt')));
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run keeps explicit preview-data favicon ahead of public auto-discovery', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));
  const previewDataPath = path.join(tempDir, 'preview.json');

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'public', 'favicon.ico'), 'icon', 'utf8');
    await fs.writeFile(path.join(tempDir, 'public', 'favicon.dark.ico'), 'dark icon', 'utf8');
    const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));
    previewData.site.favicon = {
      icon: 'https://cdn.example.com/favicon.ico',
    };
    await fs.writeFile(previewDataPath, JSON.stringify(previewData), 'utf8');

    await run([goldenThemeDir, '--data', previewDataPath]);

    const indexHtml = await fs.readFile(path.join(tempDir, 'dist', 'index.html'), 'utf8');
    assert.match(indexHtml, /<link rel="icon" href="https:\/\/cdn\.example\.com\/favicon\.ico">/);
    assert.doesNotMatch(indexHtml, /href="\/favicon\.ico"/);
    assert.doesNotMatch(indexHtml, /href="\/favicon\.dark\.ico"/);
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run ignores public robots.txt symlinks and keeps generated fallback robots', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'external-robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
    await fs.symlink(path.join(tempDir, 'external-robots.txt'), path.join(tempDir, 'public', 'robots.txt'));

    await run([goldenThemeDir, '--data', defaultPreviewDataPath]);

    const robotsTxt = await fs.readFile(path.join(tempDir, 'dist', 'robots.txt'), 'utf8');
    assert.match(robotsTxt, /^User-agent: \*\nAllow: \//);
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run ignores public favicon symlinks', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'external-favicon.ico'), 'icon', 'utf8');
    await fs.symlink(path.join(tempDir, 'external-favicon.ico'), path.join(tempDir, 'public', 'favicon.ico'));

    await run([goldenThemeDir, '--data', defaultPreviewDataPath]);

    const indexHtml = await fs.readFile(path.join(tempDir, 'dist', 'index.html'), 'utf8');
    assert.doesNotMatch(indexHtml, /favicon\.ico/);
    await assert.rejects(() => fs.access(path.join(tempDir, 'dist', 'favicon.ico')));
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run ignores public sitemap.xsl symlinks', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'public'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'external-sitemap.xsl'), '<xsl:stylesheet version="1.0"></xsl:stylesheet>', 'utf8');
    await fs.symlink(path.join(tempDir, 'external-sitemap.xsl'), path.join(tempDir, 'public', 'sitemap.xsl'));

    await run([goldenThemeDir, '--data', defaultPreviewDataPath]);

    const sitemapXml = await fs.readFile(path.join(tempDir, 'dist', 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(sitemapXml, /xml-stylesheet/);
    await assert.rejects(() => fs.access(path.join(tempDir, 'dist', 'sitemap.xsl')));
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects theme and output paths that overlap the public directory', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'public', 'theme'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'theme'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'public', 'theme', 'theme.json'), '{}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'theme', 'theme.json'), '{}', 'utf8');

    await assert.rejects(
      () => run(['public', '--data', defaultPreviewDataPath]),
      /Theme directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => run(['public/theme', '--data', defaultPreviewDataPath]),
      /Theme directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => run(['theme', '--data', defaultPreviewDataPath, '--out', 'public']),
      /Output directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => run(['theme', '--data', defaultPreviewDataPath, '--out', 'public/dist']),
      /Output directory must not overlap the public directory:/,
    );
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects paths that overlap ZEROPRESS_PUBLIC_DIR', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'docs', 'theme'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'theme'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'docs', 'theme', 'theme.json'), '{}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'theme', 'theme.json'), '{}', 'utf8');

    await assert.rejects(
      () => withPublicDirEnv('docs', () => run(['docs', '--data', defaultPreviewDataPath])),
      /Theme directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => withPublicDirEnv('docs', () => run(['docs/theme', '--data', defaultPreviewDataPath])),
      /Theme directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => withPublicDirEnv('docs', () => run(['theme', '--data', defaultPreviewDataPath, '--out', 'docs'])),
      /Output directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => withPublicDirEnv('docs', () => run(['theme', '--data', defaultPreviewDataPath, '--out', 'docs/dist'])),
      /Output directory must not overlap the public directory:/,
    );
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects paths that overlap --public-dir', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.mkdir(path.join(tempDir, 'docs', 'theme'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'theme'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'docs', 'theme', 'theme.json'), '{}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'theme', 'theme.json'), '{}', 'utf8');

    await assert.rejects(
      () => run(['docs', '--data', defaultPreviewDataPath, '--public-dir', 'docs']),
      /Theme directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => run(['docs/theme', '--data', defaultPreviewDataPath, '--public-dir', 'docs']),
      /Theme directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => run(['theme', '--data', defaultPreviewDataPath, '--out', 'docs', '--public-dir', 'docs']),
      /Output directory must not overlap the public directory:/,
    );
    await assert.rejects(
      () => run(['theme', '--data', defaultPreviewDataPath, '--out', 'docs/dist', '--public-dir', 'docs']),
      /Output directory must not overlap the public directory:/,
    );
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects a cwd public path that is not a directory', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.writeFile(path.join(tempDir, 'public'), 'not a directory', 'utf8');

    await assert.rejects(
      () => run([goldenThemeDir, '--data', defaultPreviewDataPath]),
      /Public path is not a directory:/,
    );
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects a ZEROPRESS_PUBLIC_DIR path that is not a directory', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.writeFile(path.join(tempDir, 'docs'), 'not a directory', 'utf8');

    await assert.rejects(
      () => withPublicDirEnv('docs', () => run([goldenThemeDir, '--data', defaultPreviewDataPath])),
      /Public path is not a directory:/,
    );
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('run rejects a --public-dir path that is not a directory', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-cli-'));

  try {
    process.chdir(tempDir);
    await fs.writeFile(path.join(tempDir, 'docs'), 'not a directory', 'utf8');

    await assert.rejects(
      () => run([goldenThemeDir, '--data', defaultPreviewDataPath, '--public-dir', 'docs']),
      /Public path is not a directory:/,
    );
  } finally {
    process.chdir(cwd);
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

test('run replaces a non-empty output only with --empty-out-dir', async () => {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-replace-'));
  let outDir;

  try {
    process.chdir(tempDir);
    outDir = path.join(process.cwd(), 'dist');
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'stale.txt'), 'stale output', 'utf8');

    await run([
      goldenThemeDir,
      '--data',
      defaultPreviewDataPath,
      '--out',
      outDir,
      '--empty-out-dir',
    ]);

    await fs.access(path.join(outDir, 'index.html'));
    await fs.access(path.join(outDir, 'robots.txt'));
    await assert.rejects(fs.access(path.join(outDir, 'stale.txt')), { code: 'ENOENT' });
    assert.equal(
      (await fs.readdir(tempDir)).some((entry) => entry.startsWith('.dist.zeropress-build-')),
      false,
    );
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('runBuild preserves the previous output when a replacement build fails', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-preserve-'));
  const outDir = path.join(tempDir, 'dist');
  const publicDir = path.join(tempDir, 'public');
  const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));
  previewData.version = 'invalid';

  try {
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'sentinel.txt'), 'previous output', 'utf8');

    await assert.rejects(
      () => runBuild(goldenThemeDir, previewData, outDir, {
        emptyOutDir: true,
        projectRoot: tempDir,
        publicDir,
      }),
      /Invalid preview-data/,
    );

    assert.equal(
      await fs.readFile(path.join(outDir, 'sentinel.txt'), 'utf8'),
      'previous output',
    );
    assert.deepEqual(await fs.readdir(outDir), ['sentinel.txt']);
    assert.equal(
      (await fs.readdir(tempDir)).some((entry) => entry.startsWith('.dist.zeropress-build-')),
      false,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('runBuild restricts replacement output to a safe project descendant', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-boundary-'));
  const projectRoot = path.join(tempDir, 'project');
  const outsideOutDir = path.join(tempDir, 'outside');
  const outsidePublicDir = path.join(tempDir, 'public');
  const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));

  try {
    await fs.mkdir(projectRoot);

    await assert.rejects(
      () => runBuild(goldenThemeDir, previewData, projectRoot, {
        emptyOutDir: true,
        projectRoot,
        publicDir: outsidePublicDir,
      }),
      /Replacement output directory must be strictly inside the project root:/,
    );

    await assert.rejects(
      () => runBuild(goldenThemeDir, previewData, outsideOutDir, {
        emptyOutDir: true,
        projectRoot,
        publicDir: outsidePublicDir,
      }),
      /Replacement output directory must be strictly inside the project root:/,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('runBuild accepts a replacement output child whose name starts with two periods', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-dotdot-name-'));
  const outDir = path.join(tempDir, '..dist');
  const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));

  try {
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'stale.txt'), 'stale output', 'utf8');

    await runBuild(goldenThemeDir, previewData, outDir, {
      emptyOutDir: true,
      projectRoot: tempDir,
      publicDir: path.join(tempDir, 'public'),
    });

    await fs.access(path.join(outDir, 'index.html'));
    await assert.rejects(fs.access(path.join(outDir, 'stale.txt')), { code: 'ENOENT' });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('runBuild rejects replacement output that overlaps build inputs', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-input-overlap-'));
  const themeDir = path.join(tempDir, 'theme');
  const previewDir = path.join(tempDir, 'preview-output');
  const previewDataPath = path.join(previewDir, 'preview-data.json');
  const publicDir = path.join(tempDir, 'public');
  const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));

  try {
    await fs.cp(goldenThemeDir, themeDir, { recursive: true });
    await fs.mkdir(previewDir);
    await fs.writeFile(previewDataPath, JSON.stringify(previewData), 'utf8');

    await assert.rejects(
      () => runBuild(themeDir, previewData, path.join(themeDir, 'dist'), {
        emptyOutDir: true,
        projectRoot: tempDir,
        publicDir,
      }),
      /Replacement output directory must not overlap the theme directory:/,
    );

    await assert.rejects(
      () => runBuild(themeDir, previewData, previewDir, {
        emptyOutDir: true,
        previewDataPath,
        projectRoot: tempDir,
        publicDir,
      }),
      /Replacement output directory must not contain the preview-data file:/,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('runBuild rejects symbolic-link components in a replacement output path', {
  skip: process.platform === 'win32'
    ? 'symlink creation is not consistently available on Windows'
    : false,
}, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeropress-build-output-symlink-'));
  const realDir = path.join(tempDir, 'real');
  const aliasDir = path.join(tempDir, 'alias');
  const previewData = JSON.parse(await fs.readFile(defaultPreviewDataPath, 'utf8'));

  try {
    await fs.mkdir(realDir);
    await fs.symlink(realDir, aliasDir, 'dir');

    await assert.rejects(
      () => runBuild(goldenThemeDir, previewData, path.join(aliasDir, 'dist'), {
        emptyOutDir: true,
        projectRoot: tempDir,
        publicDir: path.join(tempDir, 'public'),
      }),
      /Replacement output path must not contain symbolic links:/,
    );
    await assert.rejects(fs.access(path.join(realDir, 'dist')), { code: 'ENOENT' });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
