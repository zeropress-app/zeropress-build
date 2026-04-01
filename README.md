# @zeropress/build

![npm](https://img.shields.io/npm/v/%40zeropress%2Fbuild)
![license](https://img.shields.io/npm/l/%40zeropress%2Fbuild)
![node](https://img.shields.io/node/v/%40zeropress%2Fbuild)

ZeroPress full-build CLI.

This package is the public command-line wrapper around `@zeropress/build-core`.

It reads canonical preview-data JSON, loads a theme directory from disk, and writes a full static build to an output directory.

---

## Install

```bash
# Run directly with npx
npx @zeropress/build ./theme ./preview-data.json

# Or install globally
npm install -g @zeropress/build
zeropress-build ./theme ./preview-data.json
```

---

## Usage

```bash
zeropress-build <themeDir> <previewDataJson> [outDir]
```

Examples:

```bash
# Write to ./dist
npx @zeropress/build ./my-theme ./preview-data.json

# Write to an explicit output directory
npx @zeropress/build ./my-theme ./preview-data.json ./dist/site
```

If `outDir` is omitted, output is written to `./dist` relative to the current working directory.

The output directory must be empty before the command runs.

---

## Input Requirements

### Theme Directory

`<themeDir>` must be a local ZeroPress theme directory.

It is validated with:

- [`@zeropress/theme-validator`](https://www.npmjs.com/package/@zeropress/theme-validator)

### Preview Data

`<previewDataJson>` must be the canonical preview-data JSON contract used across the current ZeroPress toolchain.

It is validated with:

- [`@zeropress/preview-data-validator`](https://www.npmjs.com/package/@zeropress/preview-data-validator)

---

## Current Scope

v0 supports:

- full build only
- local theme directory input
- local preview-data JSON input

v0 does not yet support:

- selected-route build input
- config files
- remote preview-data URLs
- deployment or publish integration

---

## Output

On success, the CLI prints:

- generated file count
- output directory
- elapsed time

The output directory contains the normal full-build artifact set, including:

- `index.html`
- post and page routes
- hashed assets
- `sitemap.xml`
- `feed.xml`
- `robots.txt`
- `meta.json`

---

## Options

```bash
zeropress-build --help
zeropress-build --version
```

---

## Requirements

- Node.js >= 18.18.0
- ESM only

---

## Related

- [@zeropress/build-core](https://www.npmjs.com/package/@zeropress/build-core)
- [@zeropress/preview-data-validator](https://www.npmjs.com/package/@zeropress/preview-data-validator)
- [zeropress-theme](https://www.npmjs.com/package/zeropress-theme)

---

## License

MIT
