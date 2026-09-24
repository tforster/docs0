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
docs0 <docs-root> [--out=file.html] [--open=false]
```

## Arguments

| Argument      | Required | Description                                       |
| :------------ | :------: | :------------------------------------------------ |
| `<docs-root>` |   yes    | Folder whose `.md` tree is compiled into the site |

## Flags

Flags may be written with or without the leading `--`.

| Flag                          | Default     | Description                                                                                 |
| :---------------------------- | :---------- | :------------------------------------------------------------------------------------------ |
| `--out=<file>` / `out=<file>` | temp folder | Output path, relative to the current directory. Folders are created. See [Output](#output). |
| `--open=false` / `open=false` | `true`      | Skip opening the result in the default browser.                                             |
| `--no-open`                   |             | Same as `--open=false`.                                                                     |
| `-h`, `--help`                |             | Print usage and exit.                                                                       |

## Environment

| Variable        | Effect                                                                                    |
| :-------------- | :---------------------------------------------------------------------------------------- |
| `CI`            | When set, the browser is not opened unless `--open=true` is given.                        |
| `GITHUB_OUTPUT` | When set (GitHub Actions), `file=<path>` and `dir=<folder>` are appended for later steps. |

## Exit codes

| Code | Meaning                                                  |
| ---: | :------------------------------------------------------- |
|  `0` | Success                                                  |
|  `1` | Missing argument, docs root not found, or no `.md` files |

## Output

```console
$ docs0 docs --open=false

📚  DOCS0 → /tmp/docs0/my-project-3f9a1c2e/index.html
   13 pages from /home/me/project/docs · 3190 KB · 85 ms
```

Without `--out`, the file goes to `<os temp>/docs0/<project>-<hash>/index.html`: `<project>` comes from the nearest
`package.json` name (or the folder name) and `<hash>` from the absolute docs path. Nothing is written into your repo, re-running
overwrites the same file, and different projects never collide. The temp folder is `/tmp` on Linux, `$TMPDIR` on macOS,
`%TEMP%` on Windows and `$RUNNER_TEMP` on GitHub Actions.

Warnings (broken image paths, broken links, links that leave the docs tree) are printed to stderr but do not fail the build.
