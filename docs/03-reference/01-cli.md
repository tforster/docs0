# CLI <!-- omit in toc -->

## Table of Contents <!-- omit in toc -->

- [CLI](#cli)
  - [Synopsis](#synopsis)
  - [Arguments](#arguments)
  - [Flags](#flags)
  - [Environment](#environment)
  - [Exit codes](#exit-codes)
  - [Output](#output)
  - [Watch mode](#watch-mode)

## Synopsis

```bash
docs0 <docs-root> [--out=file.html] [--open=false] [-w|--watch] [-v|--verbose] [--workers=N]
```

## Arguments

| Argument      | Required | Description                                       |
| :------------ | :------: | :------------------------------------------------ |
| `<docs-root>` |   yes    | Folder whose `.md` tree is compiled into the site |

## Flags

Flags may be written with or without the leading `--`.

| Flag                            | Default     | Description                                                                                   |
| :------------------------------ | :---------- | :-------------------------------------------------------------------------------------------- |
| `--out=<file>` / `out=<file>`   | temp folder | Output path, relative to the current directory. Folders are created. See [Output](#output).   |
| `--open=false` / `open=false`   | `true`      | Skip opening the result in the default browser.                                               |
| `--no-open`                     |             | Same as `--open=false`.                                                                       |
| `-w`, `--watch`                 | `false`     | Keep running and rebuild after changes. See [Watch mode](#watch-mode).                        |
| `-v`, `--verbose`               | `false`     | List each warning (broken link, missing image). Otherwise only a count is shown.              |
| `--workers=<n>` / `workers=<n>` | auto        | Render threads. Auto uses none below 40 pages, else one per spare core (max 8). `0` = inline. |
| `-h`, `--help`                  |             | Print usage and exit.                                                                         |

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

When there are warnings and `--verbose` is off, the summary ends with `· 3 warnings (-v to list)`.

Without `--out`, the file goes to `<os temp>/docs0/<project>-<hash>/index.html`: `<project>` comes from the nearest
`package.json` name (or the folder name) and `<hash>` from the absolute docs path. Nothing is written into your repo, re-running
overwrites the same file, and different projects never collide. The temp folder is `/tmp` on Linux, `$TMPDIR` on macOS,
`%TEMP%` on Windows (also `/tmp` on GitHub-hosted Linux runners).

Warnings (broken image paths, broken links, links that leave the docs tree) are printed to stderr but do not fail the build.

## Watch mode

```console
$ docs0 docs --watch

📚  DOCS0 → /tmp/docs0/my-project-3f9a1c2e/index.html
   13 pages from /home/me/project/docs · 3190 KB · 160 ms

   Watching /home/me/project/docs · Ctrl-C to stop

↻  14:02:11  1 page re-rendered · 24 ms
```

After the first build DOCS0 keeps watching the docs root. Each save rewrites the same output file, so refresh the open tab to see
the change. Only the pages a change affects are re-rendered:

| Change                      | Re-rendered                                      |
| :-------------------------- | :----------------------------------------------- |
| A page is edited            | That page                                        |
| An image is edited          | Pages that inline it                             |
| A page is added or removed  | The new page, plus pages whose links point at it |
| Anything else (e.g. `.txt`) | Nothing; no rebuild is reported                  |

The nav, pager and folder labels are rebuilt every time, so a changed title shows up everywhere. A burst of saves (editors often
write several times) is debounced into one rebuild. If a build fails the error is printed, the last good file is kept, and
watching continues.
