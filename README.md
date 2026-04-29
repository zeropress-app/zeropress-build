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
- The payload is validated by [`@zeropress/build-core`](https://www.npmjs.com/package/@zeropress/build-core) against the canonical preview-data v0.5 contract
- Optional `custom_html` is treated as trusted site-level HTML and may inject markup before `</head>` and `</body>`
- Only provide `custom_html` from trusted admin/generator input; ZeroPress does not sanitize that HTML

### Public Directory

- If `./public/` exists in the current working directory, its files are copied to the output root before generated ZeroPress files are written
- The `public/` directory name itself is not included in the output path
- There is no `--public-dir` option; ZeroPress follows the common fixed `./public/` convention
- Public files can be used for files such as `favicon.ico`, `ads.txt`, third-party assets, source files, images, and PDFs
- If a public file and a generated ZeroPress file use the same output path, the generated file wins
- Hidden entries, `node_modules`, `Thumbs.db`, `*.key`, `*.pem`, and symlinks inside `public/` are ignored
- The theme directory and output directory must not overlap with `./public/`

---

## Output

- If `--out` is omitted, output is written to `./dist` relative to the current working directory
- The output directory must not already contain files before the command runs
- The output directory must be empty before public files are copied
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
- [@zeropress/theme](https://www.npmjs.com/package/@zeropress/theme)

---

## License

MIT
