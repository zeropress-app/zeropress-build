import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { buildSiteFromThemeDir } from '@zeropress/build-core';
import { createColor } from './color.js';

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json');
const DEFAULT_PUBLIC_DIR_NAME = 'public';
const PUBLIC_DIR_ENV_NAME = 'ZEROPRESS_PUBLIC_DIR';
const PREVIEW_DATA_SOURCE = Symbol('zeropress.previewDataSource');
const PUBLIC_FAVICON_FILES = Object.freeze({
  icon: 'favicon.ico',
  svg: 'favicon.svg',
  png: 'favicon.png',
  apple_touch_icon: 'apple-touch-icon.png',
});
const PUBLIC_SITEMAP_STYLESHEET_FILE = 'sitemap.xsl';

export async function run(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(PACKAGE_VERSION);
    return;
  }

  const { themeDir, previewDataPath, outDir, publicDir } = parseArgs(argv);
  const previewData = await loadPreviewData(previewDataPath);
  const startedAt = performance.now();

  try {
    const result = await runBuild(themeDir, previewData, outDir, { publicDir });

    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(formatBuildSuccessMessage());
    console.log(`Files: ${result.files.length}`);
    console.log(`Output: ${outDir}`);
    console.log(`Elapsed: ${elapsedMs}ms`);
  } catch (error) {
    throw mapBuildError(error, previewData);
  }
}

export function formatBuildSuccessMessage(stream = process.stdout) {
  return createColor(stream).green('Built ZeroPress site successfully');
}

function printHelp() {
  console.log(`zeropress-build - ZeroPress full-build CLI

Usage:
  zeropress-build <themeDir> --data <path> [--out <dir>] [--public-dir <dir>]

Arguments:
  <themeDir>            Theme directory to render

Options:
  --data <path>         Canonical preview-data v0.6 JSON file
  --out <dir>           Empty output directory (default: ./dist)
  --public-dir <dir>    Public passthrough directory (default: ./public)
  --help, -h            Show help
  --version, -v         Show version

Notes:
  - full build only
  - selective or patch build is not supported
  - output defaults to ./dist relative to the current working directory
  - output directory must be empty`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--data' || arg === '--out' || arg === '--public-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Invalid arguments: ${arg} requires a value`);
      }
      flags[arg.slice(2)] = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Invalid arguments: unknown option ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error('Invalid arguments: expected <themeDir> --data <path> [--out <dir>]');
  }

  if (!flags.data) {
    throw new Error('Invalid arguments: --data <path> is required');
  }

  const themeDir = path.resolve(process.cwd(), positional[0]);
  const previewDataPath = path.resolve(process.cwd(), flags.data);
  const outDir = flags.out
    ? path.resolve(process.cwd(), flags.out)
    : path.resolve(process.cwd(), 'dist');
  const publicDir = flags['public-dir']
    ? path.resolve(process.cwd(), flags['public-dir'])
    : undefined;

  return { themeDir, previewDataPath, outDir, publicDir };
}

async function loadPreviewData(previewDataPath) {
  let stat;
  try {
    stat = await fs.stat(previewDataPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`Preview-data file not found: ${previewDataPath}`);
    }
    throw error;
  }

  if (!stat.isFile()) {
    throw new Error(`Preview-data path is not a file: ${previewDataPath}`);
  }

  let raw;
  try {
    raw = await fs.readFile(previewDataPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read preview-data file: ${previewDataPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw formatPreviewDataJsonError(error, previewDataPath, raw);
  }

  if (parsed && typeof parsed === 'object') {
    Object.defineProperty(parsed, PREVIEW_DATA_SOURCE, {
      value: { path: previewDataPath, raw },
      enumerable: false,
    });
  }

  return parsed;
}

function mapBuildError(error, previewData) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith('Theme directory not found:')) {
    return new Error(message);
  }

  if (message.startsWith('Theme path is not a directory:')) {
    return new Error(message);
  }

  if (message.startsWith('Theme validation failed')) {
    const details = message.replace(/^Theme validation failed:?\s*/, '').trim();
    return new Error(`Theme validation failed${details ? `\n\n${details}` : ''}`);
  }

  if (message.startsWith('Invalid preview-data')) {
    return formatPreviewDataValidationError(message, previewData);
  }

  if (message.startsWith('Output path is not a directory:') || message.startsWith('Output directory must be empty:')) {
    return new Error(message);
  }

  if (message.startsWith('Public path is not a directory:')) {
    return new Error(message);
  }

  return new Error(`Build failed: ${message}`);
}

function formatPreviewDataJsonError(error, filePath, raw) {
  const message = error instanceof Error ? error.message : String(error);
  const location = locationForJsonParseError(message, raw);
  const lines = [
    'Invalid preview-data JSON',
    '',
    `File: ${filePath}`,
  ];

  if (location) {
    lines.push(`Line: ${location.line}, Column: ${location.column}`);
  }

  lines.push('Category: json_syntax', `Reason: ${message}`);
  return new Error(lines.join('\n'));
}

function formatPreviewDataValidationError(message, previewData) {
  const parsed = parsePreviewDataValidationMessage(message);
  if (!parsed) {
    return new Error(message);
  }

  const source = previewData && typeof previewData === 'object'
    ? previewData[PREVIEW_DATA_SOURCE]
    : null;
  const location = source ? findJsonPathLocation(source.raw, parsed.path) : null;
  const lines = [
    'Preview-data validation failed',
    '',
  ];

  if (source?.path) {
    lines.push(`File: ${source.path}`);
  }
  if (parsed.path) {
    lines.push(`Path: ${parsed.path}`);
  }
  if (location) {
    lines.push(`Line: ${location.line}, Column: ${location.column}`);
  }
  lines.push('Category: preview_data_validation', `Code: ${parsed.code}`, `Reason: ${parsed.reason}`);

  const hint = previewDataHintForIssue(parsed.code);
  if (hint) {
    lines.push('', 'Hint:', hint);
  }

  return new Error(lines.join('\n'));
}

function parsePreviewDataValidationMessage(message) {
  const match = /^Invalid preview-data:\s+([A-Z0-9_]+)\s+([^:]+):\s+(.+)$/s.exec(message);
  if (!match) {
    return null;
  }

  return {
    code: match[1],
    path: match[2].trim(),
    reason: match[3].trim(),
  };
}

function previewDataHintForIssue(code) {
  if (code === 'INVALID_MENU_ITEM_URL') {
    return 'Use an absolute URL such as "https://example.com/" or a safe site path such as "/docs/".';
  }

  return '';
}

function locationForJsonParseError(message, raw) {
  const lineColumnMatch = /\bline\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (lineColumnMatch) {
    return {
      line: Number(lineColumnMatch[1]),
      column: Number(lineColumnMatch[2]),
    };
  }

  const positionMatch = /\bposition\s+(\d+)/i.exec(message);
  if (positionMatch) {
    return locationForIndex(raw, Number(positionMatch[1]));
  }

  if (/Unexpected end of JSON input/i.test(message)) {
    return locationForIndex(raw, raw.length);
  }

  return null;
}

function findJsonPathLocation(raw, jsonPath) {
  const segments = parseJsonPathSegments(jsonPath);
  if (segments.length === 0) {
    return null;
  }

  let cursor = 0;
  let lastKeyIndex = -1;

  for (const segment of segments) {
    if (typeof segment === 'number') {
      const arrayStart = raw.indexOf('[', cursor);
      if (arrayStart === -1) {
        return lastKeyIndex >= 0 ? locationForIndex(raw, lastKeyIndex) : null;
      }
      cursor = findJsonArrayElementStart(raw, arrayStart, segment);
      if (cursor === -1) {
        return lastKeyIndex >= 0 ? locationForIndex(raw, lastKeyIndex) : null;
      }
      continue;
    }

    const keyIndex = findJsonKey(raw, segment, cursor);
    if (keyIndex === -1) {
      return lastKeyIndex >= 0 ? locationForIndex(raw, lastKeyIndex) : null;
    }
    lastKeyIndex = keyIndex;
    cursor = raw.indexOf(':', keyIndex);
    if (cursor === -1) {
      return locationForIndex(raw, keyIndex);
    }
    cursor += 1;
  }

  return lastKeyIndex >= 0 ? locationForIndex(raw, lastKeyIndex) : null;
}

function parseJsonPathSegments(jsonPath) {
  const segments = [];
  const parts = String(jsonPath || '').split('.').filter(Boolean);

  for (const part of parts) {
    const nameMatch = /^([^\[]+)/.exec(part);
    if (nameMatch) {
      segments.push(nameMatch[1]);
    }

    const indexRegex = /\[(\d+)\]/g;
    let match;
    while ((match = indexRegex.exec(part)) !== null) {
      segments.push(Number(match[1]));
    }
  }

  return segments;
}

function findJsonKey(raw, key, startIndex) {
  const needle = `"${escapeJsonString(key)}"`;
  let cursor = Math.max(0, startIndex);

  while (cursor < raw.length) {
    const keyIndex = raw.indexOf(needle, cursor);
    if (keyIndex === -1) {
      return -1;
    }
    const afterKey = keyIndex + needle.length;
    let lookahead = afterKey;
    while (/\s/.test(raw[lookahead] || '')) {
      lookahead += 1;
    }
    if (raw[lookahead] === ':') {
      return keyIndex;
    }
    cursor = afterKey;
  }

  return -1;
}

function findJsonArrayElementStart(raw, arrayStart, targetIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let elementIndex = 0;
  let elementStart = -1;

  for (let index = arrayStart + 1; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      if (elementStart === -1) {
        elementStart = index;
      }
      continue;
    }

    if (char === '[' || char === '{') {
      if (elementStart === -1) {
        elementStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === ']' || char === '}') {
      if (char === ']' && depth === 0) {
        return elementIndex === targetIndex ? elementStart : -1;
      }
      depth -= 1;
      continue;
    }

    if (/\s/.test(char)) {
      continue;
    }

    if (char === ',' && depth === 0) {
      if (elementIndex === targetIndex) {
        return elementStart;
      }
      elementIndex += 1;
      elementStart = -1;
      continue;
    }

    if (elementStart === -1) {
      elementStart = index;
    }
  }

  return -1;
}

function escapeJsonString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function locationForIndex(source, index) {
  const boundedIndex = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, source.length));
  let line = 1;
  let column = 1;

  for (let cursor = 0; cursor < boundedIndex; cursor += 1) {
    if (source[cursor] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

export async function assertThemeDirectory(themeDir) {
  let stat;
  try {
    stat = await fs.stat(themeDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`Theme directory not found: ${themeDir}`);
    }
    throw error;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Theme path is not a directory: ${themeDir}`);
  }
}

export async function runBuild(themeDir, previewData, outDir, options = {}) {
  const publicDir = resolvePublicDir(process.cwd(), options.publicDir);
  assertPublicPathDoesNotOverlap('Theme directory', themeDir, process.cwd(), publicDir);
  assertPublicPathDoesNotOverlap('Output directory', outDir, process.cwd(), publicDir);
  await assertThemeDirectory(themeDir);
  await assertEmptyOutputDirectory(outDir);
  const hasPublicRobotsTxt = await publicRobotsTxtExists(publicDir);
  const publicFavicon = await discoverPublicFavicon(publicDir);
  const sitemapStylesheetHref = await discoverPublicSitemapStylesheet(publicDir);
  await copyPublicDirectory(publicDir, outDir);
  const writer = new GeneratedOutputWriter({ outDir });
  return buildSiteFromThemeDir({
    previewData,
    themeDir,
    writer,
    options: {
      favicon: publicFavicon,
      sitemapStylesheetHref,
      generateRobotsTxt: !hasPublicRobotsTxt,
    },
  });
}

class GeneratedOutputWriter {
  constructor(options) {
    if (!options?.outDir) {
      throw new Error('GeneratedOutputWriter requires outDir');
    }
    this.outDir = options.outDir;
  }

  async write(file) {
    const relativePath = normalizeOutputPath(file.path);
    if (!relativePath) {
      throw new Error('Invalid generated output path');
    }
    const fullPath = path.join(this.outDir, relativePath);
    await ensureWritableParentPath(this.outDir, relativePath);
    await fs.rm(fullPath, { recursive: true, force: true });
    await fs.writeFile(fullPath, file.content);
  }
}

export async function assertEmptyOutputDirectory(outDir) {
  try {
    const stat = await fs.stat(outDir);
    if (!stat.isDirectory()) {
      throw new Error(`Output path is not a directory: ${outDir}`);
    }

    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      throw new Error(`Output directory must be empty: ${outDir}`);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export function resolvePublicDir(cwd = process.cwd(), publicDir) {
  if (publicDir) {
    return path.resolve(cwd, publicDir);
  }
  const envValue = process.env[PUBLIC_DIR_ENV_NAME]?.trim();
  return path.resolve(cwd, envValue || DEFAULT_PUBLIC_DIR_NAME);
}

export async function copyPublicDirectory(publicDir, outDir) {
  let rootStat;
  try {
    rootStat = await fs.lstat(publicDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Public path is not a directory: ${publicDir}`);
  }

  await copyPublicEntries(publicDir, outDir);
}

async function publicRobotsTxtExists(publicDir) {
  let stat;
  try {
    stat = await fs.lstat(path.join(publicDir, 'robots.txt'));
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return false;
    }
    throw error;
  }

  return stat.isFile();
}

export async function discoverPublicFavicon(publicDir) {
  const favicon = {};

  for (const [key, filename] of Object.entries(PUBLIC_FAVICON_FILES)) {
    let stat;
    try {
      stat = await fs.lstat(path.join(publicDir, filename));
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        continue;
      }
      throw error;
    }

    if (stat.isFile()) {
      favicon[key] = `/${filename}`;
    }
  }

  return Object.keys(favicon).length ? favicon : undefined;
}

export async function discoverPublicSitemapStylesheet(publicDir) {
  let stat;
  try {
    stat = await fs.lstat(path.join(publicDir, PUBLIC_SITEMAP_STYLESHEET_FILE));
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return undefined;
    }
    throw error;
  }

  return stat.isFile() ? `/${PUBLIC_SITEMAP_STYLESHEET_FILE}` : undefined;
}

async function copyPublicEntries(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldIgnorePublicEntry(entry.name) || entry.isSymbolicLink()) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyPublicEntries(sourcePath, targetPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

export function shouldIgnorePublicEntry(name) {
  const basename = String(name || '');
  const lowerName = basename.toLowerCase();
  return (
    basename.startsWith('.')
    || lowerName === 'node_modules'
    || lowerName === 'thumbs.db'
    || lowerName.endsWith('.key')
    || lowerName.endsWith('.pem')
  );
}

export function assertPublicPathDoesNotOverlap(label, candidatePath, cwd = process.cwd(), publicDir = resolvePublicDir(cwd)) {
  const resolvedCandidate = path.resolve(cwd, candidatePath);
  if (!pathsOverlap(publicDir, resolvedCandidate)) {
    return;
  }

  throw new Error(`${label} must not overlap the public directory: ${resolvedCandidate}`);
}

function pathsOverlap(firstPath, secondPath) {
  const first = path.resolve(firstPath);
  const second = path.resolve(secondPath);
  return first === second || isPathInside(first, second) || isPathInside(second, first);
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

async function ensureWritableParentPath(rootDir, relativePath) {
  await fs.mkdir(rootDir, { recursive: true });

  const segments = normalizeOutputPath(relativePath).split('/').filter(Boolean);
  let currentPath = rootDir;

  for (const segment of segments.slice(0, -1)) {
    currentPath = path.join(currentPath, segment);

    let stat;
    try {
      stat = await fs.lstat(currentPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        await fs.mkdir(currentPath, { recursive: true });
        continue;
      }
      throw error;
    }

    if (!stat.isDirectory()) {
      await fs.rm(currentPath, { recursive: true, force: true });
      await fs.mkdir(currentPath, { recursive: true });
    }
  }
}

function normalizeOutputPath(filePath) {
  return String(filePath || '').replace(/^\/+/, '').replace(/\\/g, '/');
}
