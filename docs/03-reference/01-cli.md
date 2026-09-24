# CLI <!-- omit in toc -->

## Table of Contents <!-- omit in toc -->

- [CLI](#cli)
  - [Synopsis](#synopsis)
  - [Arguments](#arguments)
  - [Flags](#flags)
  - [Environment](#environment)
  - [Exit codes](#exit-codes)
  - [Output](#output)

## Synopsis

```bash
docs0 <docs-root> [--out=docs.html] [--open=false]
```

## Arguments

| Argument      | Required | Description                                       |
| :------------ | :------: | :------------------------------------------------ |
| `<docs-root>` |   yes    | Folder whose `.md` tree is compiled into the site |

## Flags

Flags may be written with or without the leading `--`.

| Flag                          | Default     | Description                                                          |
| :---------------------------- | :---------- | :------------------------------------------------------------------- |
| `--out=<file>` / `out=<file>` | `docs.html` | Output path, relative to the current directory. Folders are created. |
| `--open=false` / `open=false` | `true`      | Skip opening the result in the default browser.                      |
| `--no-open`                   |             | Same as `--open=false`.                                              |
| `-h`, `--help`                |             | Print usage and exit.                                                |

## Environment

| Variable | Effect                                                             |
| :------- | :----------------------------------------------------------------- |
| `CI`     | When set, the browser is not opened unless `--open=true` is given. |

## Exit codes

| Code | Meaning                                                  |
| ---: | :------------------------------------------------------- |
|  `0` | Success                                                  |
|  `1` | Missing argument, docs root not found, or no `.md` files |

## Output

```console
$ docs0 docs --open=false

📚  DOCS0 → /home/me/project/docs.html
   13 pages from /home/me/project/docs · 3190 KB · 85 ms
```

Warnings (broken image paths, links that leave the docs tree) are printed to stderr but do not fail the build.
