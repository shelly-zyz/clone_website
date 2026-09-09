# Git Baseline Audit - 2026-09-09

## Purpose

This audit records Unit 0 of the China dashboard delivery roadmap: preserve the current repository work on GitHub before formal China dashboard production work starts.

This is a repository safety baseline, not a production China dashboard implementation. No files were deleted during the audit.

## Repository Context

| Item | Value |
|---|---|
| Local repository | `C:\Users\53472\Desktop\studying\clone_website\ai-website-cloner-template` |
| Source branch at audit start | `codex/weather-earth-polish` |
| New backup branch | `codex/github-safety-baseline-20260909` |
| Audit start commit | `0a03a460efde8d9972b34cd7fab6ac810f057319` |
| GitHub remote | `origin` / `https://github.com/shelly-zyz/clone_website.git` |
| Remote visibility checked | Private repository |
| System Git workaround | Process-local `GIT_CONFIG_NOSYSTEM=1`; system Git config was not modified |

## Dirty Worktree Classification

Initial audit found 17 tracked changed/deleted files and 115 untracked files.

| Class | Include in Git baseline? | Evidence / count | Reason |
|---|---:|---|---|
| Tracked product and data-pipeline changes | Yes | 17 tracked modified/deleted files | Existing user work that must be preserved before new dashboard work |
| New project docs and plans | Yes | `PROJECT_DASHBOARD.md`, `docs/plans/`, `docs/project-management/`, `docs/research/` | Durable project context and decisions |
| New data and operations scripts | Yes | `scripts/`, `requirements-data.txt` | Durable operational tooling for migration, backup, import, sync, validation |
| New app source files | Yes | `src/app/api/data/import-progress/route.ts`, `src/components/opengridworks/ImportProgressIndicator.tsx`, `src/lib/map-data.ts` | Existing application/source work to preserve |
| Generated course exports | No | `output/`, 26 files, about 1880.27 MiB | Generated artifacts, includes files far above GitHub's normal file-size limits |
| Root process and progress artifacts | No | 6 `*.pid` files, 2 progress files | Runtime state only; not useful repository source |
| Root previous logs | No | 2 `*.log.previous-*` files, about 30.51 MiB for the error log | Historical runtime logs; not source and too noisy for baseline |
| Root connection helper | No | `carbon-psql-env.ps1` | Contains a literal database password and connection details; must not be committed |
| Root last SQL helper | No | `carbon-psql-direct-last.sql` | Transient direct-query scratch artifact; not source |

## Included Scope

The baseline is intended to include:

- Existing tracked changes in `.gitignore`, `README.md`, `package.json`, selected data scripts, API routes, shared styles, MapLibre UI components, and weather/carbon library code.
- Deletions of retired sample/mock source files already present in the worktree: `src/lib/mock-map-data.ts` and `src/lib/weather-earth-sample.ts`.
- New project governance, data inventory, data migration, China dashboard MVP, research, and roadmap documents.
- New migration/import/sync/backup/verification scripts under `scripts/`.
- New import-progress API/component files and `src/lib/map-data.ts`.

## Excluded Scope

The following were intentionally excluded from Git and left in the working directory:

- `/output/`
- `*.pid`
- `*.log.previous-*`
- `/carbon-*-progress.json`
- `/carbon-*-progress.txt`
- `/carbon-psql-env.ps1`
- `/carbon-psql-direct-last.sql`

These paths are now covered by `.gitignore` so future `git status` and staging commands do not accidentally include them.

## Sensitive Findings

- `carbon-psql-env.ps1` contains a hard-coded database password. The value is not repeated here and the file is excluded from Git.
- Several included operational scripts reference database connection environment variables or construct connection strings at runtime. The inspected scripts use prompted or environment-provided credentials rather than hard-coded passwords.
- No private key style filenames were found in the untracked file list during the audit.
- The repository is private on GitHub, but privacy is not treated as permission to commit secrets.

## Pre-Push Verification

Completed before the initial baseline commit:

- Staged path count: 95.
- Excluded root runtime files and `/output/` files staged: 0.
- Staged files over 50 MiB: 0.
- High-confidence staged credential scan: no matches in candidate source, script, and documentation paths.
- Private-key filename scan in untracked candidates: no matches.
- `npm run lint`: passed with 1 warning in `scripts/transfer-raw-files-to-server.mjs` for an unused `crypto` import.
- `npm run typecheck`: passed.
- `git diff --cached --check`: reported trailing whitespace in existing Markdown hard-break formatting and generated README-template text. This was recorded rather than mass-reformatted during the safety baseline.
- Remote branch name was checked before local branch creation; no existing `origin/codex/github-safety-baseline-20260909` branch was found.
- The branch must be pushed without force and without overwriting existing remote history.

## Remote Verification

Pending until the baseline commit is pushed to GitHub. This section will be updated by the follow-up completion documentation commit.
