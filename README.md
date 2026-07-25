# @zeropress/build

![npm](https://img.shields.io/npm/v/%40zeropress%2Fbuild)
![license](https://img.shields.io/npm/l/%40zeropress%2Fbuild)
![node](https://img.shields.io/node/v/%40zeropress%2Fbuild)

Public ZeroPress full-build CLI for Preview Data v0.7 and Theme Runtime v0.7.

This package builds a complete static site from a ZeroPress theme directory and canonical preview-data JSON.

It uses directly:

- [@zeropress/build-core](https://www.npmjs.com/package/@zeropress/build-core) for validation, rendering, asset output, and special-file generation

Public contract references:

- [Preview Data v0.7 Spec](https://zeropress.dev/reference/preview-data/specs/v0.7/)
- [Preview Data v0.7 Schema](https://schemas.zeropress.dev/preview-data/v0.7/schema.json)
- [Theme Runtime v0.7 Spec](https://zeropress.dev/reference/theme-runtime/specs/v0.7/)
- [Theme Runtime v0.7 Schema](https://schemas.zeropress.dev/theme-runtime/v0.7/schema.json)

## Install

```bash
# Run directly with npx
npx @zeropress/build --help

# Or install globally
npm install -g @zeropress/build
zeropress-build --help
```

## Quick Start

If you need a starter theme and preview-data fixture first:

```bash
npx @zeropress/create-theme --name my-minimal --template minimal
```

Then build the generated project:

```bash
npx @zeropress/build ./my-minimal/theme --data ./my-minimal/preview-data.json --out ./dist
```

If you already have a theme and preview-data file:

```bash
npx @zeropress/build ./theme --data ./preview-data.json --out ./dist
```

For theme authoring and live preview, use [@zeropress/theme](https://www.npmjs.com/package/@zeropress/theme). For Markdown-first sites, use [@zeropress/build-pages](https://www.npmjs.com/package/@zeropress/build-pages) instead of writing preview-data by hand.

## Usage

```bash
zeropress-build <themeDir> --data <path> [--out <dir>] [--public-dir <dir>]
```

### Arguments

- `<themeDir>`: Theme directory to render

### Options

- `--data <path>`: Canonical preview-data v0.7 JSON file
- `--out <dir>`: Empty output directory, default `./dist`
- `--public-dir <dir>`: Public passthrough directory, default `./public`
- `--help, -h`: Show help
- `--version, -v`: Show version

## Examples

```bash
zeropress-build ./my-theme --data ./preview-data.json
zeropress-build ./my-theme --data ./preview-data.json --out ./dist/site
zeropress-build ./my-theme --data ./preview-data.json --public-dir ./public
```

## Programmatic API

The package root exposes the same full-build operation used by the CLI:

```js
import { runBuild } from '@zeropress/build';

const result = await runBuild(themeDir, previewData, outDir, {
  publicDir,
  generateFeed: false,
});
```

`runBuild()` accepts an absolute or working-directory-relative theme directory, canonical Preview Data v0.7, an output directory, and optional Build settings. It validates the inputs, writes the complete site, and returns the Build Core result.

## Inputs

### Theme Directory

- `<themeDir>` must be a local theme directory
- The directory is validated with [`@zeropress/theme-validator`](https://www.npmjs.com/package/@zeropress/theme-validator)

### Preview Data

- `--data <path>` must point to canonical preview-data v0.7 JSON
- The payload is validated by [`@zeropress/build-core`](https://www.npmjs.com/package/@zeropress/build-core) against the canonical preview-data v0.7 contract
- Optional `custom_html` uses trusted raw slot strings such as `{ "head_end": "<meta ...>", "body_end": "<script ...></script>" }` and injects them before `</head>` and `</body>`
- Each `custom_html` slot is limited to 65,536 Unicode code points; larger code should be served as a public asset and referenced by URL
- Only provide `custom_html` from trusted admin/generator input; ZeroPress does not sanitize that HTML
- A configured slot must exist in every theme-rendered HTML document or the build fails; standalone HTML front pages remain untouched

### Public Directory

- If the resolved public directory exists, its file paths are reserved during output planning and copied to the output root after generated ZeroPress files are written successfully
- The public directory name itself is not included in the output path
- The public directory defaults to `./public/`; use `--public-dir <dir>` or `ZEROPRESS_PUBLIC_DIR` when a project needs a different public root
- Precedence is `--public-dir` > `ZEROPRESS_PUBLIC_DIR` > `./public/`
- Relative public directory values are resolved from the current working directory
- If the resolved public path does not exist, the build continues without public passthrough
- If the resolved public path exists, it must be a real directory; files and symlinked directories are rejected
- Public files can be used for files such as `favicon.ico`, `ads.txt`, third-party assets, source files, images, and PDFs
- A public file must not collide with a generated route, asset, search artifact, or special file by public URL (including `page.html` → `/page` and `page/index.html` → `/page/` clean-host aliases), exact output path, or file/directory hierarchy. The build fails before writing instead of relying on host-specific precedence.
- `robots.txt` is the exception: a root-level public `robots.txt` is treated as the site owner's robots policy and prevents ZeroPress fallback `robots.txt` generation
- When public `robots.txt` exists, ZeroPress copies it as-is and does not append a `Sitemap` directive. Add `Sitemap: https://example.com/sitemap.xml` manually when needed.
- Root-level public favicon files named `favicon.ico`, `favicon.dark.ico`, `favicon.svg`, `favicon.png`, and `apple-touch-icon.png` are auto-discovered and injected into generated HTML `<head>` output unless preview-data already defines `site.favicon`. When both ICO files exist, `favicon.dark.ico` is used for the dark color scheme and the regular icon variants are used for the light color scheme; a lone ICO file is used for every color scheme
- A root-level public `sitemap.xsl` is copied as-is. When ZeroPress generates `sitemap.xml`, it auto-discovers that file and adds an XML stylesheet processing instruction for `/sitemap.xsl`.
- Hidden entries, `node_modules`, `Thumbs.db`, `*.key`, `*.pem`, and symlinks inside the public directory are ignored
- The theme directory and output directory must not overlap with the resolved public directory

## Output

- If `--out` is omitted, output is written to `./dist` relative to the current working directory
- The output directory must not already contain files before the command runs
- The output directory must be empty before public files are copied
- On success, the CLI prints generated file count, output directory, and elapsed time
- Full-build output includes the normal artifact set such as `index.html`, post and page routes, hashed assets, `sitemap.xml`, an enabled `feed.xml`, and fallback `robots.txt`
- If preview-data sets `site.robots.allow_indexing: false`, the generated fallback `robots.txt` disallows all agents. Custom crawler policies should be provided as public `robots.txt`.
- Native search artifacts (`/_zeropress/search.json`, `/_zeropress/search.js`, and `/_zeropress/search_pagefind.js`) are emitted only when preview-data does not set `site.search.enabled: false` and the active theme declares `features.search: true`.
- `site.feed.enabled: false` suppresses `feed.xml`; `site.archive.enabled: false` suppresses chronological archive routes. Disabled outputs do not reserve their public paths.

## Supported

- Full build only
- Local theme directory input
- Local preview-data JSON input

## License

MIT
