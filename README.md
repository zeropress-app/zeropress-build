# @zeropress/build

![npm](https://img.shields.io/npm/v/%40zeropress%2Fbuild)
![license](https://img.shields.io/npm/l/%40zeropress%2Fbuild)
![node](https://img.shields.io/node/v/%40zeropress%2Fbuild)

Public ZeroPress full-build CLI for Preview Data v0.6 and Theme Runtime v0.6.

This package builds a complete static site from a ZeroPress theme directory and canonical preview-data JSON.

It uses directly:

- [@zeropress/build-core](https://www.npmjs.com/package/@zeropress/build-core) for validation, rendering, asset output, and special-file generation

Public contract references:

- [Preview Data v0.6 Spec](https://zeropress.dev/spec/preview-data-v0.6.html)
- [Preview Data v0.6 Schema](https://schemas.zeropress.dev/preview-data/v0.6/schema.json)
- [Theme Runtime v0.6 Spec](https://zeropress.dev/spec/theme-runtime-v0.6.html)
- [Theme Runtime v0.6 Schema](https://schemas.zeropress.dev/theme-runtime/v0.6/schema.json)

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

- `--data <path>`: Canonical preview-data v0.6 JSON file
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

## Inputs

### Theme Directory

- `<themeDir>` must be a local theme directory
- The directory is validated with [`@zeropress/theme-validator`](https://www.npmjs.com/package/@zeropress/theme-validator)

### Preview Data

- `--data <path>` must point to canonical preview-data v0.6 JSON
- The payload is validated by [`@zeropress/build-core`](https://www.npmjs.com/package/@zeropress/build-core) against the canonical preview-data v0.6 contract
- Optional `custom_html` is treated as trusted site-level HTML and may inject markup before `</head>` and `</body>`
- Only provide `custom_html` from trusted admin/generator input; ZeroPress does not sanitize that HTML

### Public Directory

- If the resolved public directory exists, its files are copied to the output root before generated ZeroPress files are written
- The public directory name itself is not included in the output path
- The public directory defaults to `./public/`; use `--public-dir <dir>` or `ZEROPRESS_PUBLIC_DIR` when a project needs a different public root
- Precedence is `--public-dir` > `ZEROPRESS_PUBLIC_DIR` > `./public/`
- Relative public directory values are resolved from the current working directory
- If the resolved public path does not exist, the build continues without public passthrough
- If the resolved public path exists, it must be a real directory; files and symlinked directories are rejected
- Public files can be used for files such as `favicon.ico`, `ads.txt`, third-party assets, source files, images, and PDFs
- If a public file and a generated ZeroPress file use the same output path, the generated file wins
- `robots.txt` is the exception: a root-level public `robots.txt` is treated as the site owner's robots policy and prevents ZeroPress fallback `robots.txt` generation
- When public `robots.txt` exists, ZeroPress copies it as-is and does not append a `Sitemap` directive. Add `Sitemap: https://example.com/sitemap.xml` manually when needed.
- Root-level public favicon files named `favicon.ico`, `favicon.svg`, `favicon.png`, and `apple-touch-icon.png` are auto-discovered and injected into generated HTML `<head>` output unless preview-data already defines `site.favicon`
- A root-level public `sitemap.xsl` is copied as-is. When ZeroPress generates `sitemap.xml`, it auto-discovers that file and adds an XML stylesheet processing instruction for `/sitemap.xsl`.
- Hidden entries, `node_modules`, `Thumbs.db`, `*.key`, `*.pem`, and symlinks inside the public directory are ignored
- The theme directory and output directory must not overlap with the resolved public directory

## Output

- If `--out` is omitted, output is written to `./dist` relative to the current working directory
- The output directory must not already contain files before the command runs
- The output directory must be empty before public files are copied
- On success, the CLI prints generated file count, output directory, and elapsed time
- Full-build output includes the normal artifact set such as `index.html`, post and page routes, hashed assets, `sitemap.xml`, `feed.xml`, and fallback `robots.txt`
- If preview-data sets `site.indexing: false`, the generated fallback `robots.txt` disallows all agents. Custom crawler policies should be provided as public `robots.txt`.
- Native search artifacts (`/_zeropress/search.json`, `/_zeropress/search.js`, and `/_zeropress/search_pagefind.js`) are emitted only when preview-data does not set `site.search: false` and the active theme declares `features.search: true`.

## Supported

- Full build only
- Local theme directory input
- Local preview-data JSON input

## Not Supported

- Selective or patch build input
- Config files
- Remote preview-data URLs
- Deployment or publish integration

## License

MIT
