# dsh-mail-notify v0.5.1 — GitHub Release Report

**Status:** `PASS_GITHUB_RELEASE_AWAITING_MANUAL_NPM`

- Repository: `E:\Projects\DSHarness\dsh-mail-notify`
- GitHub repository: `HaowenCang/dsh-mail-notify`
- Release version: `0.5.1`
- Execution window: 2026-10-17 21:06–21:10 America/Los_Angeles
  (2026-10-18 04:06–04:10 UTC)
- npm publication: **not performed**. It is handed off to the maintainer for interactive 2FA.

## 1. Baseline and release source

| Item | Value | Expected | Result |
|---|---|---|---|
| Source branch | `compat/dsh-0.2.1-rc.2` | same | PASS |
| Source branch HEAD | `9d7675f7e9c6f6645004b016361e111d1a58e2df` | same | PASS |
| `main` before merge | `83a0998a71424d78f8b1b2dc1c4630b05af5bb5b` | same | PASS |
| PR #1 state | `MERGED` | merged | PASS |
| Merge commit | `103cdb90b8cd93196c5288f52d8163e499bc4dc5` | new | PASS |
| **`RELEASE_SOURCE_SHA`** | `103cdb90b8cd93196c5288f52d8163e499bc4dc5` | verified main HEAD | PASS |

`RELEASE_SOURCE_SHA` is the actual post-merge `main` HEAD and the peeled target of tag
`v0.5.1`. No unverified new `main` commit was used as the release source.

## 2. Pre-release read-only gates

| Gate | Observed | Result |
|---|---|---|
| Git worktree clean | no tracked/untracked changes (except the two report files created after) | PASS |
| `origin/main` | `83a0998a71424d78f8b1b2dc1c4630b05af5bb5b` | PASS |
| `origin/compat/dsh-0.2.1-rc.2` | `9d7675f7e9c6f6645004b016361e111d1a58e2df` | PASS |
| PR #1 head / mergeability | head `9d7675f…`, `MERGEABLE`, `mergeStateStatus: CLEAN` | PASS |
| npm `0.5.1` absent | registry versions end at `0.5.0`; `/0.5.1` returns HTTP 404 | PASS |
| Git tag `v0.5.1` absent | not present locally or on `origin` | PASS |
| GitHub Release `v0.5.1` absent | `release not found` | PASS |
| Frozen archive present | `dsh-mail-notify-0.5.1.tgz`, 204992 bytes | PASS |
| SHA-256 | `82B8A99F31EA158FF5EC4E4C8E97367BF3EA5F43CEF7DE0668F3864AD5E54FA5` | PASS |
| SHA-1 | `0A8E00BCC1DF9E8835A6104BD03EEB0B9182AF1B` | PASS |

The frozen archive was not modified, rebuilt, re-packed, or replaced with `npm pack`.

## 3. PR #1 merge

- URL: https://github.com/HaowenCang/dsh-mail-notify/pull/1
- Title: `release: dsh-mail-notify v0.5.1 — DSH 0.2.1-rc.2 compatibility`
- State: `MERGED`
- Merged at: `2026-10-18T04:07:26Z`
- Merged by: `HaowenCang`
- Base at merge: `83a0998a71424d78f8b1b2dc1c4630b05af5bb5b`
- Head at merge: `9d7675f7e9c6f6645004b016361e111d1a58e2df`
- Merge method: ordinary merge commit (no squash, no rebase)
- Merge commit: `103cdb90b8cd93196c5288f52d8163e499bc4dc5`
- Merge commit parents: `83a0998a71424d78f8b1b2dc1c4630b05af5bb5b` (pre-release `main`) +
  `9d7675f7e9c6f6645004b016361e111d1a58e2df` (compat branch HEAD)
- The original eight development/acceptance commits are retained as ancestors of the merge commit.
- The `compat/dsh-0.2.1-rc.2` branch was not deleted or rewritten.

Command used:

```powershell
gh pr merge 1 --repo HaowenCang/dsh-mail-notify --merge --match-head-commit 9d7675f7e9c6f6645004b016361e111d1a58e2df
```

## 4. Post-merge Git state and tree consistency

After `git fetch origin --prune --tags`:

| Check | Value | Result |
|---|---|---|
| `origin/main` | `103cdb90b8cd93196c5288f52d8163e499bc4dc5` | PASS |
| `origin/compat/dsh-0.2.1-rc.2` | `9d7675f7e9c6f6645004b016361e111d1a58e2df` (unchanged) | PASS |
| Merge commit tree | `45650fe6da587e32c1fe6c6b82fa65b8e443b7f0` | PASS |
| Compat HEAD tree | `45650fe6da587e32c1fe6c6b82fa65b8e443b7f0` | PASS |
| `git diff origin/main origin/compat/dsh-0.2.1-rc.2` | empty (exit 0) | PASS |
| `package.json` version on `main` | `0.5.1` | PASS |
| `engines.dsh` on `main` | `0.2.1-rc.2` (exact) | PASS |
| `@deepseek-ai/dsh-credentials` peer | `0.2.1-rc.2` | PASS |
| `@deepseek-ai/dsh-session` peer | `0.2.1-rc.2` | PASS |
| Root `@deepseek-ai/dsh` peer | absent | PASS |

The merge commit tree is byte-for-byte identical to the compatibility branch HEAD tree.

## 5. Annotated tag `v0.5.1`

- Tag object SHA: `679ef593d5c3e080281a578f012052c37c44e93a`
- Object type: `tag` (annotated, not lightweight)
- Tagger: `Evan Williams <54177361+HaowenCang@users.noreply.github.com>`
- Tag message: `dsh-mail-notify v0.5.1 — DSH 0.2.1-rc.2 compatibility`
- Peeled target: `103cdb90b8cd93196c5288f52d8163e499bc4dc5` = `RELEASE_SOURCE_SHA`

Remote refs after push (no force push):

```text
679ef593d5c3e080281a578f012052c37c44e93a	refs/tags/v0.5.1
103cdb90b8cd93196c5288f52d8163e499bc4dc5	refs/tags/v0.5.1^{}
```

The tag was not moved, overwritten, or force-pushed after creation.

## 6. GitHub Release

- URL: https://github.com/HaowenCang/dsh-mail-notify/releases/tag/v0.5.1
- Release ID: `416224241`
- Title: `dsh-mail-notify v0.5.1`
- Tag: `v0.5.1` (pre-existing annotated tag, created with `--verify-tag`)
- Draft: `false`
- Prerelease: `false` (the plugin version `0.5.1` is a normal release; its target DSH host is an RC)
- Latest: `true` (`/releases/latest` resolves to release `416224241`)
- Published at: `2026-10-18T04:08:43Z`
- Release asset:
  - Name: `dsh-mail-notify-0.5.1.tgz`
  - Asset ID: `652429349`
  - Node ID: `RA_kwDOUYyDC84m40gl`
  - Size: `204992` bytes
  - Upload state: `uploaded`
  - API digest: `sha256:82b8a99f31ea158ff5ec4e4c8e97367bf3ea5f43cef7de0668f3864ad5e54fa5`

The asset was uploaded in the same `gh release create` call as the release itself; no empty
release was published first. Repository Immutable Releases were checked and reported
`{"enabled":false,"enforced_by_owner":false}`.

Release notes body:

- Prepared as a separate formal body in `RELEASE_BODY_V0.5.1.md`, based on
  `RELEASE_NOTES_V0.5.1.md`.
- Stale candidate/status text was removed: the "Release candidate — not published, no tag" header,
  the `(release candidate)` qualifier, and the `RELEASE CANDIDATE / NOT PUBLISHED / NOT TAGGED /
  NO GITHUB RELEASE` status block.
- All functional, compatibility, migration, verification, and limitation content was retained.
- It does **not** state that npm publication happened. It states only: "GitHub release asset is
  published. npm publication is performed separately by the maintainer using interactive 2FA."
- Repository-relative documentation links were converted to absolute `blob/v0.5.1` URLs so they
  resolve inside a GitHub Release body.
- The published body was read back and compared to the local file after the final edit; they are
  identical (9740 characters, normalized line endings).

## 7. GitHub artifact read-back verification

The release asset was downloaded from GitHub into two fresh isolated directories, separate from the
frozen archive:

- `E:\Projects\DSHarness\dsh-mail-notify-release-verify-v0.5.1\`
- `E:\Projects\DSHarness\dsh-mail-notify-release-verify-v0.5.1-b\`

| Property | Frozen local archive | GitHub download (run A) | GitHub download (run B) | Expected | Result |
|---|---|---|---|---|---|
| Size (bytes) | 204992 | 204992 | 204992 | 204992 | PASS |
| SHA-256 | `82B8A99F31EA158FF5EC4E4C8E97367BF3EA5F43CEF7DE0668F3864AD5E54FA5` | same | same | same | PASS |
| SHA-1 | `0A8E00BCC1DF9E8835A6104BD03EEB0B9182AF1B` | same | same | same | PASS |

The original frozen archive was not overwritten. Both downloads were taken after the release was
published; the second was taken after the release-notes body was finalized. Bytes are identical in
all three copies.

## 8. `v0.5.0` historical invariance

Checked before and after the release; nothing changed.

| Item | Value (unchanged) |
|---|---|
| Tag object SHA | `a0bb456baab04b181cf2e10af493b809a628f6be` |
| Tag type | annotated `tag` |
| Peeled commit | `911f168a09b9ee5720459d1e8339187d3e5e91f2` |
| GitHub Release ID | `400799387` |
| Release name | `dsh-mail-notify v0.5.0` |
| Release published at | `2026-10-01T09:04:57Z` |
| Release asset ID | `602851853` |
| Release asset name | `dsh-mail-notify-0.5.0.tgz` |
| Release asset size | `203186` bytes |
| Release asset digest | `sha256:7c93bccf69b4a34e809ed1a046c2f7fd32ffee873b9a5287663ab660440f59a0` |

The `v0.5.0` tag, Release, and asset were not moved, replaced, or restated.

## 9. npm registry status at handoff

`npm view dsh-mail-notify versions --json` returned:

```json
["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]
```

`https://registry.npmjs.org/dsh-mail-notify/0.5.1` returns HTTP 404. Version `0.5.1` is not
published on npm.

No npm publication command was run, no 2FA code was requested, no token was used to bypass 2FA, and
no `npm dist-tag` was modified.

## 10. Not executed (explicit)

None of the following was run during this phase:

- `npm publish` (or any npm registry write)
- `npm run verify`
- `npm test`
- `npm ci`
- `npm run build`
- `npm run typecheck`
- Any E2E, Host, Chrome, or SMTP probe
- Any real DSH profile operation or test
- `npm dist-tag` or any tag mutation
- Any rebuild, re-pack, or `npm pack` of the release artifact

**No development test was re-run in this phase.** Every verification claim above concerns Git,
GitHub, npm registry read-only state, and archive hashes only; the test results quoted in the
release notes are the recorded development-phase results, not results produced during this release.

## 11. Post-release documentation

`RELEASE_BODY_V0.5.1.md` and this report are added by post-release documentation commits on
`main`, after the GitHub Release was created and verified (the initial commit, then a correction
to this report's download-timing sentence). Those commits:

- are **not** part of `RELEASE_SOURCE` (`103cdb90b8cd93196c5288f52d8163e499bc4dc5`);
- do **not** move tag `v0.5.1` (tag object `679ef593d5c3e080281a578f012052c37c44e93a`, peeled
  target unchanged);
- do not alter the Release or its asset.

## 12. Handoff

The GitHub phase is complete. The remaining step is manual npm publication of `dsh-mail-notify@0.5.1`
by the maintainer using interactive 2FA, at the maintainer's discretion, including any dist-tag
decision. Until that is done, `0.5.0` remains the latest npm version.

**Final status: `PASS_GITHUB_RELEASE_AWAITING_MANUAL_NPM`**
