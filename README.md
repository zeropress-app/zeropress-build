# @zeropress/build

![npm](https://img.shields.io/npm/v/%40zeropress%2Fbuild)
![license](https://img.shields.io/npm/l/%40zeropress%2Fbuild)
![node](https://img.shields.io/node/v/%40zeropress%2Fbuild)

ZeroPress full-build CLI.

This package is the public CLI wrapper around `@zeropress/build-core`.

---

## Install

```bash
# Run directly with npx
npx @zeropress/build --help

# Or install globally
npm install -g @zeropress/build
zeropress-build --help
```

---

## Quick Start

```bash
npx @zeropress/build ./theme --data ./preview-data.json
```

---

## Usage

```bash
zeropress-build <themeDir> --data <path> [--out <dir>]
```

### Arguments

- `<themeDir>`: Theme directory to render

### Options

- `--data <path>`: Canonical preview-data v0.5 JSON file
- `--out <dir>`: Empty output directory, default `./dist`
- `--help, -h`: Show help
- `--version, -v`: Show version

---

## Examples

```bash
zeropress-build ./my-theme --data ./preview-data.json
zeropress-build ./my-theme --data ./preview-data.json --out ./dist/site
```

---

## Inputs

### Theme Directory

- `<themeDir>` must be a local theme directory
- The directory is validated with [`@zeropress/theme-validator`](https://www.npmjs.com/package/@zeropress/theme-validator)

### Preview Data

- `--data <path>` must point to canonical preview-data v0.5 JSON
- The payload is validated with [`@zeropress/preview-data-validator`](https://www.npmjs.com/package/@zeropress/preview-data-validator)

---

## Output

- If `--out` is omitted, output is written to `./dist` relative to the current working directory
- The output directory must not already contain files before the command runs
- On success, the CLI prints generated file count, output directory, and elapsed time
- Full-build output includes the normal artifact set such as `index.html`, post and page routes, hashed assets, `sitemap.xml`, `feed.xml`, and `robots.txt`

---

## Supported

- Full build only
- Local theme directory input
- Local preview-data JSON input

## Not Supported

- Selective or patch build input
- Config files
- Remote preview-data URLs
- Deployment or publish integration

---

## Requirements

- Node.js >= 18.18.0
- ESM only

---

## Related

- [@zeropress/build-core](https://www.npmjs.com/package/@zeropress/build-core)
- [@zeropress/preview-data-validator](https://www.npmjs.com/package/@zeropress/preview-data-validator)
- [@zeropress/theme](https://www.npmjs.com/package/@zeropress/theme)

---

## License

MIT
