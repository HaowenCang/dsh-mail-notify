# dsh-mail-notify v0.5.2 — GitHub Release Report

**Status:** `PASS_GITHUB_RELEASE_AWAITING_MANUAL_NPM`

- Repository: `E:\Projects\DSHarness\dsh-mail-notify`
- GitHub repository: `HaowenCang/dsh-mail-notify`
- Release version: `0.5.2`
- Target Git tag: `v0.5.2`
- npm publication: **not performed**. It is handed off to the maintainer for interactive 2FA.

## 1. Baseline and release source

| Item | Value | Expected | Result |
|---|---|---|---|
| Source branch | `compat/dsh-0.2.1-rc.3` | same | PASS |
| Source branch HEAD | `b3d160003a59225c0539cb779eefb6b00ab7d497` | same | PASS |
| `main` before merge | `93fb6d341dfc1172082929c1b96b785730828b26` | same | PASS |
| PR #2 state | `MERGED` | merged | PASS |
| Merge commit | `dab495da9f59e9a77f5153b060e0ae1db8008b44` | new | PASS |
| **`RELEASE_SOURCE_SHA`** | `dab495da9f59e9a77f5153b060e0ae1db8008b44` | verified main HEAD | PASS |

`RELEASE_SOURCE_SHA` is the actual post-merge `main` HEAD and the peeled target of tag `v0.5.2`.
The merge was performed with `--match-head-commit` against the verified branch head, so no
unverified new `main` commit was used as the release source.

## 2. Pre-release read-only gates

| Gate | Observed | Result |
|---|---|---|
| Git worktree clean | no tracked/untracked changes before the merge | PASS |
| `origin/main` | `93fb6d341dfc1172082929c1b96b785730828b26` | PASS |
| `origin/compat/dsh-0.2.1-rc.3` | `b3d160003a59225c0539cb779eefb6b00ab7d497` | PASS |
| PR #2 head / base | head `b3d1600…`, base `93fb6d3…` | PASS |
| PR #2 mergeability | `MERGEABLE`, `mergeStateStatus: CLEAN`, not draft | PASS |
| npm `0.5.2` absent | `npm view dsh-mail-notify@0.5.2` returns E404; registry versions end at `0.5.1` | PASS |
| Git tag `v0.5.2` absent | not present locally or on `origin` | PASS |
| GitHub Release `v0.5.2` absent | `gh release view v0.5.2` → `release not found` | PASS |
| Frozen archive present | `dsh-mail-notify-0.5.2.tgz`, 205985 bytes | PASS |
| SHA-256 | `0A21E750FE32B47C0BDCB1F8C9500A6A3597373092BD4E6E376C2D76F08FFF76` | PASS |
| SHA-512 integrity | `sha512-yfFryiga8SfHU1fKkfOjgmpCVjxsiUj25z6vxR4vYpNIsadwnhuKZCxT/9FsPhXy6hRm6f6t4Y0UggzfevksPw==` | PASS |
| Archive entry count | 113 | PASS |

The frozen-archive path was taken from the Phase 0.5.2-COMPAT artifact manifest, not guessed:
`_phase052-compat/build/ARTIFACT.md` §1 and `artifact-0.5.2.json` `archive.file` both identify
`dsh-mail-notify-0.5.2.tgz` at the repository root
(`E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.2.tgz`). A recursive search found no
other same-named archive outside `node_modules`; the superseded pre-docs archive
`53FC7DC8…2F25` is stored under `_phase052-compat/build/frozen-53fc/` under a distinct filename and
was not used.

**The artifact hash gate passed before any GitHub write operation.** The archive was not modified,
rebuilt, re-packed, replaced, or regenerated with `npm pack`.

## 3. PR #2 merge

- URL: https://github.com/HaowenCang/dsh-mail-notify/pull/2
- Title: `release: dsh-mail-notify v0.5.2 — DSH 0.2.1 compatibility range`
- State: `MERGED`
- Merged at: `2026-10-24T14:18:46Z`
- Base at merge: `93fb6d341dfc1172082929c1b96b785730828b26`
- Head at merge: `b3d160003a59225c0539cb779eefb6b00ab7d497`
- Merge method: ordinary merge commit (no squash, no rebase)
- Merge commit: `dab495da9f59e9a77f5153b060e0ae1db8008b44`
- Merge commit message: `Merge pull request #2 from HaowenCang/compat/dsh-0.2.1-rc.3`
- Merge commit parents: `93fb6d341dfc1172082929c1b96b785730828b26` (pre-release `main`) +
  `b3d160003a59225c0539cb779eefb6b00ab7d497` (compat branch HEAD)
- All four PR commits are retained as ancestors of the merge commit
  (`7a6f8ee`, `ce52f05`, `e95134d`, `b3d1600`).
- The `compat/dsh-0.2.1-rc.3` branch was not deleted or rewritten; `origin` still has it at
  `b3d1600`.

Command used:

```powershell
gh pr merge 2 --repo HaowenCang/dsh-mail-notify --merge --match-head-commit b3d160003a59225c0539cb779eefb6b00ab7d497
```

## 4. Post-merge Git state and tree consistency

After `git fetch origin --prune`:

| Check | Value | Result |
|---|---|---|
| `origin/main` | `dab495da9f59e9a77f5153b060e0ae1db8008b44` | PASS |
| `origin/compat/dsh-0.2.1-rc.3` | `b3d160003a59225c0539cb779eefb6b00ab7d497` (unchanged) | PASS |
| Merge commit tree | `787dd0249b2f229430cb46b6afc2e0125dad9447` | PASS |
| Compat HEAD tree | `787dd0249b2f229430cb46b6afc2e0125dad9447` | PASS |
| `git diff` merge commit vs compat HEAD | empty (exit 0) | PASS |
| `package.json` version | `0.5.2` | PASS |
| `engines.dsh` | `>=0.2.1-rc.2 <0.2.2-0` | PASS |
| `@deepseek-ai/dsh-credentials` peer | `>=0.2.1-rc.2 <0.2.2-0` | PASS |
| `@deepseek-ai/dsh-session` peer | `>=0.2.1-rc.2 <0.2.2-0` | PASS |

The merge commit tree is byte-for-byte identical to the compatibility branch HEAD tree.

## 5. Annotated tag `v0.5.2`

- Tag object SHA: `d7b4c70711052090c7c2dc8743861ce824da875c`
- Object type: `tag` (annotated, not lightweight; confirmed both locally and by the GitHub Git-ref
  API)
- Tagger: `Evan Williams <54177361+HaowenCang@users.noreply.github.com>`, date
  `2026-10-24T14:19:54Z`
- Tag message: `dsh-mail-notify v0.5.2 — DSH 0.2.1 compatibility range`
  (the message bytes were compared to the prepared message file; the U+2014 em dash is present as
  UTF-8 `E2 80 94` in the tag object)
- Peeled target: `dab495da9f59e9a77f5153b060e0ae1db8008b44` = `RELEASE_SOURCE_SHA`

Remote refs after push (no force push):

```text
d7b4c70711052090c7c2dc8743861ce824da875c	refs/tags/v0.5.2
dab495da9f59e9a77f5153b060e0ae1db8008b44	refs/tags/v0.5.2^{}
```

The tag was created only after the merge gates passed, points at the verified merge commit (not at
the development branch head and not at an unverified new `main` commit), and was not moved,
overwritten, or force-pushed afterwards.

## 6. GitHub Release

- URL: https://github.com/HaowenCang/dsh-mail-notify/releases/tag/v0.5.2
- Release ID: `422775479`
- Title: `dsh-mail-notify v0.5.2`
- Tag: `v0.5.2` (pre-existing annotated tag, created with `--verify-tag`)
- Draft: `false`
- Prerelease: `false`
- Latest: `true` (`/releases/latest` resolves to release `422775479` / tag `v0.5.2`)
- Created at: `2026-10-24T14:19:54Z`
- Published at: `2026-10-24T14:20:50Z`
- Targeted commitish reported by the API: `main` (the release binds to the annotated tag, whose
  peeled target is `dab495d…`)
- Release asset:
  - Name: `dsh-mail-notify-0.5.2.tgz`
  - Asset ID: `672455503`
  - Node ID: `RA_kwDOUYyDC84oFNtP`
  - Size: `205985` bytes
  - Content type: `application/x-gtar`
  - Upload state: `uploaded`
  - API digest: `sha256:0a21e750fe32b47c0bdcb1f8c9500a6a3597373092bd4e6e376c2d76f08fff76`
    (matches the local SHA-256, case-insensitively)

The asset was uploaded in the same `gh release create` call as the release itself; no empty release
was published first.

Command used:

```powershell
gh release create v0.5.2 dsh-mail-notify-0.5.2.tgz `
  --repo HaowenCang/dsh-mail-notify `
  --title "dsh-mail-notify v0.5.2" `
  --notes-file RELEASE_BODY_V0.5.2.md `
  --verify-tag --latest
```

Repository Immutable Releases were checked and reported
`{"enabled":false,"enforced_by_owner":false}`; immutability therefore relies on the recorded tag
object and asset digest, not on the GitHub setting.

Release notes body:

- Prepared as a separate formal body in `RELEASE_BODY_V0.5.2.md`, based on
  `RELEASE_NOTES_V0.5.2.md`.
- Stale candidate/status text was removed: the `RELEASE CANDIDATE` / `NOT TAGGED` /
  `NO GITHUB RELEASE` / `NOT MERGED TO MAIN` status block and the "release candidate — not
  published, no tag" header. It now states the GitHub release is published and that npm publication
  is still pending.
- It does **not** state that npm publication happened. It states: this GitHub Release is published
  with the frozen archive attached, while npm publication is performed separately by the maintainer
  with interactive 2FA, and installs should use the release asset until then.
- It states explicitly that only DSH `0.2.1-rc.2` and `0.2.1-rc.3` were measured and claimed, and
  that later `0.2.1-*` releases and `0.2.1` final are admitted by the range but untested and not
  claimed.
- Repository-relative documentation links were converted to absolute `blob/v0.5.2` URLs; all four
  targets (`V0.5.2_COMPAT_AUDIT.md`, `RELEASE_NOTES_V0.5.2.md`, `V0.5.1_COMPAT_REPORT.md`,
  `V0.5.1_COMPAT_R1_REPORT.md`) were verified to exist at the tag.
- The published body was read back from the GitHub API and compared byte-for-byte (after
  line-ending normalization) to the local file: identical, 14062 normalized bytes, SHA-256
  `EF7F8A18BCED1813956D898FED68A60AB561972C186EC3CC37D1EEDEA4C22E78`.

## 7. GitHub artifact read-back verification

The release asset was downloaded from GitHub into a **new isolated directory**, independent of the
frozen archive and of the release workspace:

- `E:\Projects\DSHarness\_phase052-release\verify\download-v0.5.2\dsh-mail-notify-0.5.2.tgz`

The download and all checks were performed by an independent verifier agent (fresh context) that
derived the expected identity from the Phase 0.5.2-COMPAT manifest itself, rather than from this
report. It reported `overallPass: true`, `failures: []`, 25/25 checks passing, and confirmed that it
modified no repository file. It additionally re-derived the in-archive identity: entry lists are
identical, and `package/package.json` (`DDD38C83…F282C0`, version `0.5.2`) and `package/README.md`
(`2E26F07E…3C0A0F`) match the manifest's anchor hashes.

| Property | Frozen local archive | GitHub download | Expected | Result |
|---|---|---|---|---|
| Size (bytes) | 205985 | 205985 | 205985 | PASS |
| SHA-256 | `0A21E750FE32B47C0BDCB1F8C9500A6A3597373092BD4E6E376C2D76F08FFF76` | `0A21E750FE32B47C0BDCB1F8C9500A6A3597373092BD4E6E376C2D76F08FFF76` | same | PASS |
| SHA-512 integrity | `sha512-yfFryiga8SfHU1fKkfOjgmpCVjxsiUj25z6vxR4vYpNIsadwnhuKZCxT/9FsPhXy6hRm6f6t4Y0UggzfevksPw==` | `sha512-yfFryiga8SfHU1fKkfOjgmpCVjxsiUj25z6vxR4vYpNIsadwnhuKZCxT/9FsPhXy6hRm6f6t4Y0UggzfevksPw==` | same | PASS |
| Archive entries | 113 | 113 | 113 | PASS |
| Byte-identical to frozen archive | — | yes | yes | PASS |
| GitHub API asset digest | — | `sha256:0a21e750fe32b47c0bdcb1f8c9500a6a3597373092bd4e6e376c2d76f08fff76` | local SHA-256 | PASS |

The original frozen archive was not overwritten, and the downloaded copy is a separate file. The
verifier also re-checked that the release is `draft=false`, `prerelease=false`, that it is the latest
release, that the tag is annotated with peeled target `dab495d…`, and that `v0.5.1` is unchanged
(§9). Evidence: `_phase052-release\verify\READBACK.json` and `READBACK.md`.

## 8. npm registry status at handoff

`npm view dsh-mail-notify versions --json` returns versions ending at:

```json
["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.5.1"]
```

`npm view dsh-mail-notify@0.5.2` returns HTTP 404 (both before the merge and after the release),
and `npm view dsh-mail-notify dist-tags --json` is:

```json
{ "latest": "0.5.1" }
```

Version `0.5.2` is **not** published on npm. No npm publication command was run, no 2FA code was
requested, entered, or forwarded, no npm token was used to bypass 2FA, and no npm dist-tag was
modified.

## 9. `v0.5.1` historical invariance

Checked before and after the release; nothing changed.

| Item | Value (unchanged) |
|---|---|
| Tag object SHA | `679ef593d5c3e080281a578f012052c37c44e93a` |
| Tag type | annotated `tag` |
| Peeled commit | `103cdb90b8cd93196c5288f52d8163e499bc4dc5` |
| GitHub Release ID | `416224241` |
| Release name | `dsh-mail-notify v0.5.1` |
| Release published at | `2026-10-18T04:08:43Z` |
| Release asset ID | `652429349` |
| Release asset name | `dsh-mail-notify-0.5.1.tgz` |
| Release asset size | `204992` bytes |
| Release asset digest | `sha256:82b8a99f31ea158ff5ec4e4c8e97367bf3ea5f43cef7de0668f3864ad5e54fa5` |

The `v0.5.1` tag, Release, and asset were not moved, replaced, deleted, or restated.

## 10. Not executed (explicit)

None of the following was run during this phase:

- `npm publish` (or any npm registry write)
- `npm test`, `npm run verify`, `npm run typecheck`, `npm ci`, `npm run build`
- Any E2E, SMTP, host/probe, or browser run
- Any real DSH profile operation, real `DSH_HOME`, or user profile access
- `npm pack` / re-pack / rebuild of the release artifact
- `npm dist-tag` or any tag mutation
- Any movement, deletion, or force-push of an existing tag

**No development test, build, compile, pack, E2E, SMTP, host probe, or npm pack was re-run in this
phase.** Every verification claim above concerns Git, GitHub, npm registry read-only state, and
archive hashes only. The test and runtime results quoted in the release notes are the recorded
development-phase results, not results produced during this release.

## 11. Post-release documentation

`RELEASE_BODY_V0.5.2.md` and this report are added by a post-release documentation commit on
`main`, after the GitHub Release was created and verified. That commit:

- is **not** part of `RELEASE_SOURCE` (`dab495da9f59e9a77f5153b060e0ae1db8008b44`);
- does **not** move tag `v0.5.2` (tag object `d7b4c70711052090c7c2dc8743861ce824da875c`, peeled
  target unchanged);
- does not alter the Release or its asset.

The documentation commit is identifiable with
`git log --oneline -1 -- RELEASE_V0.5.2_GITHUB.md` (subject
`docs(release): record the v0.5.2 GitHub release`); its full SHA is reported in the operator
handoff. The GitHub Release and asset predate it and are untouched by it.

## 12. Handoff

The GitHub phase is complete. The remaining step is manual npm publication of
`dsh-mail-notify@0.5.2` by the maintainer using interactive 2FA, at the maintainer's discretion,
including any dist-tag decision. Until that is done, `0.5.1` remains the latest npm version.

**Final status: `PASS_GITHUB_RELEASE_AWAITING_MANUAL_NPM`**

## Appendix — evidence files

| File | Contents |
|---|---|
| `_phase052-release\preflight.json` | pre-flight worktree/PR/tag/release/npm/artifact snapshot |
| `_phase052-release\merge.json` | PR #2 merge state, merge commit, parents, tree equality, manifest checks |
| `_phase052-release\tag.json` | annotated tag object, peeled target, remote refs, v0.5.1 invariance |
| `_phase052-release\tag-object.bin` | raw annotated tag object bytes (message byte check) |
| `_phase052-release\release-api.json` | GitHub Release API response |
| `_phase052-release\release-body-from-api-raw.md` | release body read back from the API (byte compare) |
| `_phase052-release\RELEASE_BODY_V0.5.2.md` | release body used by `gh release create` |
| `_phase052-release\verify\READBACK.json` | independent download/hash read-back evidence |
| `_phase052-release\verify\READBACK.md` | independent read-back summary |
