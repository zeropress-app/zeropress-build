import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { assertPreviewData } from '@zeropress/preview-data-validator';
import { buildSiteFromThemeDir } from '@zeropress/build-core';

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json');
const PUBLIC_DIR_NAME = 'public';

export async function run(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(PACKAGE_VERSION);
    return;
  }

  const { themeDir, previewDataPath, outDir } = parseArgs(argv);
  const previewData = await loadPreviewData(previewDataPath);
  const startedAt = performance.now();

  try {
    const result = await runBuild(themeDir, previewData, outDir);

    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log('Built ZeroPress site successfully');
    console.log(`Files: ${result.files.length}`);
    console.log(`Output: ${outDir}`);
    console.log(`Elapsed: ${elapsedMs}ms`);
  } catch (error) {
    throw mapBuildError(error);
  }
}

function printHelp() {
  console.log(`zeropress-build - ZeroPress full-build CLI

Usage:
  zeropress-build <themeDir> --data <path> [--out <dir>]

Arguments:
  <themeDir>            Theme directory to render

Options:
  --data <path>         Canonical preview-data v0.5 JSON file
  --out <dir>           Empty output directory (default: ./dist)
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

    if (arg === '--data' || arg === '--out') {
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

  return { themeDir, previewDataPath, outDir };
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
    throw new Error(`Invalid preview-data JSON: ${error.message}`);
  }

  try {
    assertPreviewData(parsed);
  } catch (error) {
    throw new Error(`Invalid preview-data: ${error.message}`);
  }

  return parsed;
}

function mapBuildError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith('Theme directory not found:')) {
    return new Error(message);
  }

  if (message.startsWith('Theme path is not a directory:')) {
    return new Error(message);
  }

  if (message.startsWith('Theme validation failed:')) {
    return new Error(`Theme invalid: ${message.replace('Theme validation failed: ', '')}`);
  }

  if (message.startsWith('Invalid preview-data')) {
    return new Error(message);
  }

  if (message.startsWith('Output path is not a directory:') || message.startsWith('Output directory must be empty:')) {
    return new Error(message);
  }

  if (message.startsWith('Public path is not a directory:')) {
    return new Error(message);
  }

  return new Error(`Build failed: ${message}`);
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

export async function runBuild(themeDir, previewData, outDir) {
  assertPublicPathDoesNotOverlap('Theme directory', themeDir);
  assertPublicPathDoesNotOverlap('Output directory', outDir);
  await assertThemeDirectory(themeDir);
  await assertEmptyOutputDirectory(outDir);
  await copyPublicDirectory(resolvePublicDir(), outDir);
  const writer = new GeneratedOutputWriter({ outDir });
  return buildSiteFromThemeDir({
    previewData,
    themeDir,
    writer,
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

export function resolvePublicDir(cwd = process.cwd()) {
  return path.resolve(cwd, PUBLIC_DIR_NAME);
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

export function assertPublicPathDoesNotOverlap(label, candidatePath, cwd = process.cwd()) {
  const publicDir = resolvePublicDir(cwd);
  const resolvedCandidate = path.resolve(cwd, candidatePath);
  if (!pathsOverlap(publicDir, resolvedCandidate)) {
    return;
  }

  throw new Error(`${label} must not overlap the cwd public directory: ${resolvedCandidate}`);
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
