import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { assertPreviewData } from '@zeropress/preview-data-validator';
import { buildSiteFromThemeDir, FilesystemWriter } from '@zeropress/build-core';

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json');

export async function run(argv) {
  const firstArg = argv[0];

  if (!firstArg || firstArg === '--help' || firstArg === '-h') {
    printHelp();
    return;
  }

  if (firstArg === '--version' || firstArg === '-v') {
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
  zeropress-build <themeDir> <previewDataJson> [outDir]

Arguments:
  <themeDir>         Theme directory to render
  <previewDataJson>  Canonical preview-data JSON file
  [outDir]           Empty output directory (default: ./dist)

Options:
  --help, -h         Show help
  --version, -v      Show version

Notes:
  - v0 supports full build only
  - selected-route input is not supported yet
  - output defaults to ./dist relative to the current working directory
  - output directory must not already contain files`);
}

function parseArgs(argv) {
  const positional = [];

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      throw new Error(`Invalid arguments: unknown option ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length < 2 || positional.length > 3) {
    throw new Error('Invalid arguments: expected <themeDir> <previewDataJson> [outDir]');
  }

  const themeDir = path.resolve(process.cwd(), positional[0]);
  const previewDataPath = path.resolve(process.cwd(), positional[1]);
  const outDir = positional[2]
    ? path.resolve(process.cwd(), positional[2])
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
  await assertThemeDirectory(themeDir);
  await assertEmptyOutputDirectory(outDir);
  const writer = new FilesystemWriter({ outDir });
  return buildSiteFromThemeDir({
    previewData,
    themeDir,
    writer,
  });
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
