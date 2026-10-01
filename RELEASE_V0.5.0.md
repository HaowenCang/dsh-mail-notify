# dsh-mail-notify v0.5.0 — release report

## Status

```text
PASS — v0.5.0 RELEASED
```

`dsh-mail-notify v0.5.0` is published to npm, tagged in Git, and attached to a GitHub Release.
Compatibility is claimed for **DSH 0.2.0-rc.2** only.

The release resumed from a previous run that had stopped at
`PARTIAL — v0.5.0 RELEASE BLOCKED AT AUTHENTICATION`. Nothing had been published, tagged, merged, or
packaged for release at that point, so no release state had to be rolled back.

## Release identity

| Item | Value |
| --- | --- |
| RELEASE_SOURCE | `911f168a09b9ee5720459d1e8339187d3e5e91f2` |
| Release-source subject | `docs(rc): correct v0.5.0 config-surface evidence` |
| Feature branch | `feat/v0.5.0-dsh-0.2.0-compat` |
| Feature vs main before merge | 5 ahead, 0 behind |
| Tag | annotated `v0.5.0` |
| TAG_OBJECT_SHA | `a0bb456baab04b181cf2e10af493b809a628f6be` |
| Tag peeled target | `911f168a09b9ee5720459d1e8339187d3e5e91f2` (= RELEASE_SOURCE) |
| Tagger | Evan Williams `<54177361+HaowenCang@users.noreply.github.com>`, `1790844799 -0700` |
| npm version | `0.5.0` |
| npm `dist-tags.latest` | `0.5.0` |
| npm `_npmUser` | `evan-williams` |
| npm publish time (registry) | `2026-10-01T08:59:52.260Z` |
| npm packument modified | `2026-10-01T08:59:52.423Z` |
| npm `dist.shasum` (sha1) | `39306aadcafb7b840dc818dfdd0b6f6723baa20e` |
| npm `dist.integrity` | `sha512-myPx+XdpxFeyJHgFYQsI1hke7rHrXsgnh1YtyGoLRCneyy2k+GiEGaFR+fd7uioPl4XOJw0pGoPMC+ltw5MMVA==` |
| npm `dist.fileCount` | `113` |
| npm `dist.unpackedSize` | `742495` |
| GitHub Release id | `400799387` |
| GitHub Release node_id | `RE_kwDOUYyDC84X47ab` |
| GitHub Release name | `dsh-mail-notify v0.5.0` |
| GitHub Release draft / prerelease | `false` / `false` |
| GitHub Release created_at | `2026-10-01T08:53:19Z` |
| GitHub Release published_at | `2026-10-01T09:04:57Z` |
| GitHub Release targetCommitish | `main` |
| GitHub asset id | `602851853` |
| GitHub asset node_id | `RA_kwDOUYyDC84j7soN` |
| GitHub asset state | `uploaded` |
| GitHub asset created_at / updated_at | `2026-10-01T09:04:55Z` / `2026-10-01T09:04:56Z` |
| GitHub asset API digest | `sha256:7c93bccf69b4a34e809ed1a046c2f7fd32ffee873b9a5287663ab660440f59a0` |

## Artifact integrity

```text
dsh-mail-notify-0.5.0.tgz
FINAL_ARCHIVE_SIZE        203186
FINAL_ARCHIVE_SHA256      7C93BCCF69B4A34E809ED1A046C2F7FD32FFEE873B9A5287663AB660440F59A0
FINAL_ARCHIVE_ENTRY_COUNT 113
```

Three-way identity, each computed from the **downloaded bytes** rather than from a digest string:

| Source | Size | SHA-256 |
| --- | --- | --- |
| Local retained archive | 203 186 | `7C93BCCF69B4A34E809ED1A046C2F7FD32FFEE873B9A5287663AB660440F59A0` |
| npm registry tarball (downloaded) | 203 186 | `7C93BCCF69B4A34E809ED1A046C2F7FD32FFEE873B9A5287663AB660440F59A0` |
| GitHub Release asset (downloaded) | 203 186 | `7C93BCCF69B4A34E809ED1A046C2F7FD32FFEE873B9A5287663AB660440F59A0` |

```text
LOCAL_SHA256 == NPM_SHA256 == GITHUB_SHA256   PASS
LOCAL_SIZE   == NPM_SIZE   == GITHUB_SIZE     PASS
```

`dist.integrity` and the GitHub API `digest` agree with the downloaded bytes and are recorded as
supplementary evidence only.

### Superseded RC archive

The earlier RC artifact `dsh-mail-notify-0.5.0.tgz`, 202 906 bytes, SHA-256
`C67F65654F53C8C21E1311FEA7587B8071D0DFF2B090AFF40F832455087D41EB`, was superseded: the final RC
evidence commit modified `README.md`, and `README.md` enters the npm tarball. It was renamed to
`dsh-mail-notify-0.5.0-rc-superseded.tgz` in place so it can never be mistaken for the release
artifact. It was not published, uploaded, or tagged. The final archive differs from it, as required.

## Client identity

```text
FINAL_CLIENT_SHA256  638AD1BEB606BBFEE5D43B69F62B7E0F30C429F819D672AAACA8A7E06C27761E
```

This value is identical in all four places it was measured:

| Surface | client.js SHA-256 |
| --- | --- |
| Repository build (`npm run build` → `lib/client.js`, 68 925 bytes) | `638AD1BEB606BBFEE5D43B69F62B7E0F30C429F819D672AAACA8A7E06C27761E` |
| Final release tarball | `638AD1BEB606BBFEE5D43B69F62B7E0F30C429F819D672AAACA8A7E06C27761E` |
| Superseded RC archive used by the browser E2E | `638AD1BEB606BBFEE5D43B69F62B7E0F30C429F819D672AAACA8A7E06C27761E` |
| Installed package (both isolated installs) | `638AD1BEB606BBFEE5D43B69F62B7E0F30C429F819D672AAACA8A7E06C27761E` |

A hash, not a file size, is the evidence. `911f168` touched no path under `src/client/**`, and the
last commit to change `src/client/**` is `4a41f0e`, which precedes the browser E2E run. The
`STOP — CLIENT ARTIFACT CHANGED` condition therefore did not occur.

## Verification

Source gates, all run from the exact `RELEASE_SOURCE`:

| Gate | Result |
| --- | --- |
| `npm run check:text` | PASS — 166 text files, strict UTF-8, BOM-free, no known mojibake |
| `npm run typecheck` | PASS — three programs, no diagnostics |
| `npm test` | **575 tests, 575 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo** |
| `npm run build` | PASS — `tsc` ×2 plus `tsdown` (`lib/client.js`, 68.92 kB) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `git diff --check` | clean |
| `npm run pack:check` | PASS — required entries present, no forbidden entry |
| `npm run scan:secrets` | PASS — 113 entries, 742 495 bytes, 0 credential-value hits, 0 shaped-literal hits |

Package content audit of the final tarball — every one of the 113 entries classified:
26 `lib/*.js`, 25 `lib/*.js.map`, 33 `lib/types/**/*.d.ts`, 25 `lib/types/**/*.d.ts.map`, plus
`package.json`, `README.md`, `LICENSE`, and `cordis.patch.yml`. No `src/`, `tests/`, `scripts/`,
`tmp/`, `_isolated/`, `V0.5.0_COMPAT_REPORT.md`, `.credentials*`, `.env*`, `*.pem`, `*.key`, nested
`.tgz`, SMTP receipt, browser profile, or probe output. The `lib/types/**` entries are intentional:
`package.json` `types` and `exports` resolve into them and they are inside the declared `files`
policy.

The build was re-run and `lib/client.js` hashed before and after, yielding the same value — the
tests therefore exercised a runtime that the release build reproduces byte for byte.

## Browser E2E evidence

```text
browser E2E not rerun because executable plugin/client bytes are unchanged
```

The recorded browser run is **26 / 26 assertions passed** (`V0.5.0_COMPAT_REPORT.md` §12): real
Chrome over the DevTools Protocol against a real `dsh web` instance booted from a disposable
`DSH_HOME` on port 51231, with the packed `0.5.0` archive installed through the real plugin manager.
The waiver holds on two conditions, both verified above: the plugin and client bytes are unchanged
since that run (identical `lib/client.js` SHA-256), and the final tarball installs through the real
DSH 0.2.0-rc.2 plugin manager. The recovered labels were explicitly **23 Config labels plus one
separate write-only password Credential label** (`config 23/23, credential 1/1`).

## Real-assembly evidence

Real-assembly probes substitute exactly three things — the human, the model's tokens, and the SMTP
peer's identity — and run the real agent loop, tool registry, session log, credential store, and SMTP
conversation. `V0.5.0_COMPAT_REPORT.md` §14 records the eight-scenario matrix. Additionally re-run
for this release against the final archive:

| Run | Result |
| --- | --- |
| `questions` (isolated DSH_HOME, fresh profile, real `dsh plugin add`) | exit 0; 2 messages — `[DSH] Input required — Choose Mode`, `[DSH] Task completed — probe-scripted`; credential contract 14 PASS / 0 FAIL |
| `errors` (registry-installed bytes) | exit 0; 1 message — `[DSH] Task failed — QUOTA (402)`; credential contract 14 PASS / 0 FAIL |

## Compatibility

DSH 0.2.0-rc.2 — validated. Compatibility is claimed for that harness release only.

- The package pins `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-session` to exactly
  `0.2.0-rc.2`, as confirmed in the published registry metadata.
- **v0.4.0 is refused by the DSH 0.2 compatibility gate** on its `peerDependencies` alone, with no
  exemption available.
- **v0.5.0 is accepted without exemption.** Installing the final tarball with a real
  `dsh plugin --profile <profile> add` against DSH 0.2.0-rc.2 succeeded, the bundle was recognised,
  and the Host loaded it and delivered notifications. No `compatibility.json` exemption, no
  accept-risk path, and no peer bypass was used anywhere.

`v0.4.0 remains the DSH 0.1.7-rc.2 line.` This release does not extend, replace, or restate that
claim, and it does not claim DSH 0.2.0 final or any later prerelease.

## Publication sequence

1. Operators resumed after the earlier authentication stop; the §3 preflight then passed
   (`npm whoami` = `evan-williams`, `gh auth status` = authenticated).
2. The full resume-state guard confirmed `HEAD` = `origin/feat/...` = `911f168`, `origin/main` =
   `558ae48`, a clean tree, and no v0.5.0 publication object of any kind.
3. `npm pack` produced the final archive; `pack:check` and `scan:secrets` passed.
4. Publication state was rechecked immediately before the merge, then `main` was fast-forwarded
   `558ae48 → 911f168` and pushed. No merge commit, no squash, no rebase, no force push; all five
   recovery/provenance commits (`4a41f0e`, `9097cec`, `6988378`, `561e0f5`, `911f168`) were preserved.
5. The annotated tag was created locally and verified (`type = tag`, peel = RELEASE_SOURCE).
6. `npm publish .\dsh-mail-notify-0.5.0.tgz` — the explicit tarball, never a bare `npm publish`.
   npm required a web-authentication step; the operator completed it locally. The npm log records
   `PUT 202`, `exit 0`, `info ok` for a 113-file, 203.2 kB tarball with shasum
   `39306aadcafb7b840dc818dfdd0b6f6723baa20e`. No OTP, token, or credential value was recorded.
7. The registry tarball was downloaded and hashed: bytes identical to the local archive.
8. A fresh isolated DSH_HOME with a new profile installed the registry tarball; its 113 installed
   files are byte-for-byte the registry tarball's.
9. Only `v0.5.0` was pushed (`git push origin v0.5.0`, never `--tags`); the remote tag object and peel
   match the local ones, and all five older tags still match their local objects.
10. The GitHub Release was created as a non-draft, non-prerelease release with the exact tarball
    attached; its body is byte-identical to `RELEASE_NOTES_V0.5.0.md`.

## Git state after release

| Ref | Value |
| --- | --- |
| `main` before the documentation commit | `911f168a09b9ee5720459d1e8339187d3e5e91f2` |
| `v0.5.0` tag object / peel | `a0bb456baab04b181cf2e10af493b809a628f6be` / `911f168a09b9ee5720459d1e8339187d3e5e91f2` |
| Older tags `v0.1.0`–`v0.4.0` | unchanged, remote objects match local objects |

The post-release documentation commit moves `main` forward by documentation only. The tag is not
moved: `v0.5.0` continues to point at `RELEASE_SOURCE`.

## Isolation

```text
real C:\Users\20659\.dsh modified: NO
```

Every install and boot used an independent `DSH_HOME` with a newly created isolated profile, on DSH
**0.2.0-rc.2**:

| Purpose | Isolated DSH_HOME | Isolated profile |
| --- | --- | --- |
| Local archive install | `E:\Projects\DSHarness\_release-check\dsh-mail-notify-v050` | `mail-notify-v050-release` |
| Real Host-load boot | `E:\Projects\DSHarness\_release-check\dsh-mail-notify-v050-hostload\home` | `mail-notify-v050-release` |
| Registry archive install | `E:\Projects\DSHarness\_release-check\dsh-mail-notify-v050-registry` | `mail-notify-v050-registry` |
| Registry bytes Host-load boot | `E:\Projects\DSHarness\_release-check\dsh-mail-notify-v050-registry-boot\home` | `mail-notify-v050-registry` |

No plugin was installed into a real profile, no real profile was modified, the real DSH was not
restarted, no real profile was copied for testing, and no credentials were modified. No browser E2E
was run against the real DSH. No `$HOME`/`$home` scratch variable was used.

The one real-home access that did occur is disclosed in full:

- **Read-only:** `npm run scan:secrets` reads the credential store to compare the shipping bytes
  against live credential values in memory. Values are never printed, hashed reversibly, or passed as
  arguments; the scan emitted only names, lengths, truncated hashes, and 0 hits.
- **A mistake, corrected:** an exploratory `dsh plugin --profile probe-x --help` auto-initialised an
  empty template profile at `C:\Users\20659\.dsh\profiles\probe-x` (6 files, `dependencies: {}`, no
  plugin installed, empty `pnpm.log`). With the operator's approval it was deleted after asserting the
  resolved path, its leaf, its parent, zero dependencies, and the absence of any `dsh-mail-notify`
  reference. `profiles` is back to `desktop`, `tpm-phase94-isolated`, `tpm-phase941-runtime`, `web`,
  and no `dsh-mail-notify` reference exists anywhere in the real home. No pre-existing profile was
  modified.

Recent timestamps under the real home (`attachments`, `dsh-usage`, `storages`, `sessions`) are the
live DSH application's own session writes, not plugin-test modifications.

## Known limitations

- Only DSH 0.2.0-rc.2 is claimed. No other harness release, including DSH 0.2.0 final and any later
  prerelease, is claimed.
- The notification queue is nonpersistent: queued jobs do not survive a restart.
- Deduplication is process-local: it does not span processes or restarts.
- SMTP acceptance is not mailbox delivery. A message the server accepted may still fail to reach a
  mailbox.
- Question and approval notifications are notification-only.
- There is no action callback: a mail cannot answer a question or decide an approval.
- The timed-question tests are not a timing soak. They assert the three outcomes deterministically
  (answered before timeout, timeout → `pending`, late reply) and do not measure behaviour under
  sustained timing load.
- The browser E2E did not spend a real model plan to drive notification. The isolated web profile
  composes the real model provider, so driving a Turn there would spend real quota; those families
  are covered by the real-assembly probes instead. The browser run covers the configuration surface.
- The default privacy switches remain off, so notification traffic is opt-in:
  `includeSubagents`, `includeUserPrompt`, `notifyErrors`, `notifyQuestions`, `notifyApprovals` are
  all `false`.

## Scope not performed

No v0.5.1 work was started. No compatibility claim beyond DSH 0.2.0-rc.2 was made. No release object
was created a second time: the archive was packed once, and that exact artifact is what npm and the
GitHub Release both carry.
