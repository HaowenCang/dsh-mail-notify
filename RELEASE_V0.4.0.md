# dsh-mail-notify v0.4.0 — release report

## Status

```text
PASS — v0.4.0 RELEASED
```

The release resumed after npm authentication was restored, advanced `main` to the already-frozen
release source by fast-forward, published the retained archive to npm, tagged the source, created the
GitHub Release from that same archive, and confirmed that the local archive, the npm registry
artifact, and the GitHub Release asset are byte-identical. No source, test, configuration, or
dependency change was made during publication.

## Release identity

| Item | Value |
| --- | --- |
| Release source commit | `c9fad0a2b44c122d753b483d64b318f612dd6ce0` |
| Release source tree | `176b46977ad22d36167e3c94cf587ecbec66ff97` |
| Annotated tag object | `a34387d524bb7b753c1e1e5242bece695e707091` |
| Tag target (peeled) | `c9fad0a2b44c122d753b483d64b318f612dd6ce0` |
| npm package / version | `dsh-mail-notify@0.4.0` (dist-tag `latest`) |
| npm `dist.integrity` | `sha512-c2ytN+Nykwo9WPDhjf+WJp8dCdXGX2YyoQIKGJHhW9uRTNwVOzGrmNTAGWN0fzz3KSnXgP6wGNTHDh19BddCLQ==` |
| npm `dist.shasum` | `d766522baa6d1080c13a5ea1a12c24644b9275e6` |
| npm published | `2026-09-28T12:45:31.992Z` |
| GitHub Release | `dsh-mail-notify v0.4.0`, REST id `398248407`, node_id `RE_kwDOUYyDC84XvMnX` |
| GitHub Release published | `2026-09-28T12:53:04Z` |
| GitHub Release asset | `dsh-mail-notify-0.4.0.tgz`, 201 918 bytes, asset id `595408360` |
| Previous release | `v0.3.0`, tag object `2ee3141f1d86710f527e831fd34d599a8052fef9`, target `b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4` |

## Artifact integrity

Every figure below was measured from bytes, not read from metadata.

| Source | Bytes | SHA-256 |
| --- | --- | --- |
| Local retained archive | 201 918 | `CE185447466FDC8AA908E37F937FE2003BCC956E3FC681D968E6FCCDFA22FB78` |
| npm registry tarball | 201 918 | `CE185447466FDC8AA908E37F937FE2003BCC956E3FC681D968E6FCCDFA22FB78` |
| GitHub Release asset | 201 918 | `CE185447466FDC8AA908E37F937FE2003BCC956E3FC681D968E6FCCDFA22FB78` |

```text
LOCAL == NPM == GITHUB
```

The npm side is the tarball the registry metadata names, downloaded and hashed from bytes;
`dist.integrity` was recorded as corroboration and never used as a substitute. The GitHub side is the
asset downloaded from the Release; the REST `digest` field
(`sha256:ce185447466fdc8aa908e37f937fe2003bcc956e3fc681d968e6fccdfa22fb78`) agrees, and was likewise
not used as a substitute for hashing the bytes.

The archive was not regenerated at any point in this phase: it was retained from the frozen release
preparation, and its identity was checked before publication and again afterwards.

## Resume-state guard

The guard was run before any publication step, and every required condition held:

```text
HEAD = origin/feat/v0.4.0-dsh-0.1.7-compat = c9fad0a2b44c122d753b483d64b318f612dd6ce0
origin/main                                 = 6f42b2f167c33fd6b3fd2e1a0f04695d50e2d93f
working tree                                clean
local v0.4.0 tag                            absent
remote v0.4.0 tag                           absent
npm 0.4.0                                   absent (latest = 0.3.0)
GitHub Release v0.4.0                       absent
```

`gh release view v0.4.0` returned `release not found`, which is the expected state before publication.
No existing tag, version, or release was overwritten.

## Main fast-forward

`main` was advanced by fast-forward only, from `6f42b2f` to the release source:

```text
6f42b2f..c9fad0a  main -> main
```

`git rev-list --parents -n 1 HEAD` reports the single parent `aee15d9`, so the result is neither a
merge commit nor a squash commit. No rebase and no force push was performed. Local `main` and
`origin/main` both resolve to `c9fad0a2b44c122d753b483d64b318f612dd6ce0` after the push, and the
working tree is clean.

## Publication sequence

The order was deliberate: bytes verified before publication, and the tag pushed only after npm
artifact equality was established.

1. Archive identity reconfirmed: 201 918 bytes,
   `CE185447466FDC8AA908E37F937FE2003BCC956E3FC681D968E6FCCDFA22FB78`. The validated client artifact
   `lib/client.js` was reconfirmed at
   `93E3CA78981E93A01950C3736CBB5204854225D02DB0061FDB8003FAD732282E`.
2. `main` fast-forwarded and pushed.
3. Annotated tag created at the release source; the tag object and its peeled target were verified
   before the tag was pushed.
4. `npm publish .\dsh-mail-notify-0.4.0.tgz` run against the exact retained archive.
5. Registry tarball downloaded and hashed; equality with the local archive established.
6. `git push origin v0.4.0` — the tag name was pushed explicitly, never `--tags`.
7. GitHub Release created with the retained archive as its asset.

The first publication attempt was refused with `EOTP` at 20:18 local time and created no publication
object; the operator then completed the npm Web-auth flow in a separate terminal, whose npm log ends
with `PUT 202`, `notice Your package is being processed and may take a few minutes to become
available.`, and `exit 0`. The version became visible on the registry at 20:45:45 local time. No
credential material was requested, printed, or recorded at any point.

## Verification of the published package

The registry-downloaded archive was installed into a disposable tree under
`E:\Projects\DSHarness\_scratch-mail-notify-v040` (`DSH_HOME` pointed inside it, so no real harness
home was read or written) and verified there:

| Check | Result |
| --- | --- |
| Installed package version | `0.4.0` |
| Installed package name | `dsh-mail-notify` |
| `lib/client.js` SHA-256 | `93E3CA78981E93A01950C3736CBB5204854225D02DB0061FDB8003FAD732282E` — matches the validated bundle |
| Bundle recognised | `dsh.bundle.patch = ./cordis.patch.yml` present and naming the plugin entry |
| Host plugin loads | Published `lib/index.js` mounted a live runtime through a real Cordis context: `status().active === true`, queue statistics readable, `plugin.ready` emitted, queue disposed cleanly |
| Client bundle present | Yes |

Two limits of this check are stated rather than glossed over. The mount resolved the exact peer builds
the DSH installation ships, copied into the disposable tree, instead of resolving peers from the
registry; and the archive was installed as a file tree rather than through `dsh plugin add`. This is
therefore a file-level fresh-install check: it proves the published bytes import, declare their
bundle, and mount, but the bundle-assembly path through a profile was last exercised during the
pre-publication verification, not repeated here.

## Documentation alignment note

`V0.4.0_COMPAT_REPORT.md` §28.3 records the archive as `ECC8FAFD…` at 201 678 bytes. That measurement
was taken at commit `ff7c1ca`; commit `c9fad0a` later rewrote `README.md` and `docs/PRODUCT_SPEC.md`,
and the release archive was packed after that commit, which is why its size and hash differ. The
retained archive is nonetheless the archive of the frozen release source, and this was established by
content rather than inferred from timestamps:

```text
archive README.md (line endings normalised) == HEAD:README.md blob  cec2e141221d088ca24109da407ddc6676e4c063
archive LICENSE                             == HEAD:LICENSE blob    73bc522e922f…
archive cordis.patch.yml                    == HEAD:cordis.patch.yml blob 01191d4ad400…
archive lib/client.js SHA-256               == 93E3CA78981E93A01950C3736CBB5204854225D02DB0061FDB8003FAD732282E
```

The 749-byte difference in `README.md` is line-ending conversion alone, introduced when the archive
was packed from a Windows working tree: the same 52 417 codepoints, the same 749 lines, no textual
divergence. `V0.4.0_COMPAT_REPORT.md` was left unamended, because the release source was frozen and
this phase was instructed not to modify it; the superseding figures are recorded here.

## Verification gates

These gates were run and recorded during the frozen pre-publication phase; they are reproduced here as
reported by `V0.4.0_COMPAT_REPORT.md` §28, not re-run during publication.

| Gate | Result |
| --- | --- |
| `npm run check:text` | PASS |
| `npm run typecheck` | PASS — host, client, and test programs |
| `npm test` | PASS — **561 pass, 0 fail, 0 skipped** |
| `npm run build` | PASS — `lib/client.js` 68.98 kB (gzip 20.77 kB) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm pack` | `dsh-mail-notify-0.4.0.tgz` (201 918 bytes) |
| `npm run pack:check` | PASS — required entries present, no forbidden entry |
| `npm run scan:secrets` | PASS — 113 entries, 0 credential-value hits, 0 shaped-literal hits |
| Policy suite (`notifier`, `attention-policy`, `attention-notification`) | PASS — 52 pass, 0 fail, 0 skipped |

## What v0.4.0 contains

The plugin's configuration moved onto DSH's native volatile Config: fields are declared with
`configForms`, written through `plugins.bundle.config`, and the Loader's `loader/volatile-update`
rebuilds the runtime from a fresh snapshot, so a change saved in the Web UI takes effect without
restarting DSH. The card exposes 23 Config controls plus one write-only Credential control for the
SMTP password; the password is never a Config value and no read path returns it. An inconsistent
document is refused by Host pre-persistence Standard Schema product validation, and a refusal leaves
the running plugin untouched.

Notification behaviour changed in four ways. Direct-human prompt attribution is decided by
`source.kind === 'user'`, so injected runtime context, skills, goals, agent instructions, and
agent-to-agent messages are excluded whatever their text. A user fork is distinguished from a
subagent, and a terminal classification of `forked` is available. Terminal errors are mailed even
when the failed turn produced no visible output. Question and approval notifications were added.
An approval mail carries the tool name and the request's own reason text; approval ids, call ids,
tool arguments, reasoning, and credential values are not sent.

The shipped privacy defaults keep notification traffic opt-in:

```text
includeSubagents   = false
includeUserPrompt  = false
notifyErrors       = false
notifyQuestions    = false
notifyApprovals    = false
```

## Git state after release

```text
release source       c9fad0a2b44c122d753b483d64b318f612dd6ce0
local main           c9fad0a2b44c122d753b483d64b318f612dd6ce0
origin/main          c9fad0a2b44c122d753b483d64b318f612dd6ce0
v0.4.0 tag target    c9fad0a2b44c122d753b483d64b318f612dd6ce0
working tree         clean at the time of publication
```

`v0.1.0`, `v0.1.1`, `v0.2.0`, and `v0.3.0` were neither moved, deleted, recreated, nor force-updated;
each still resolves to the same annotated tag object and target commit. No tag other than `v0.4.0` was
created or pushed.

## Known limitations

- Compatibility is claimed for DSH `0.1.7-rc.2` only. No broader compatibility is asserted, and no
  later harness release has been tested against this artifact.
- The registry fresh-install check verified the published file tree and its mount through the
  published entry point, resolving the peer builds the DSH installation ships. Peer resolution from
  the registry and the `dsh plugin add` bundle-assembly path were not repeated after publication.
- The card's status facts are polled; the host pushes none of them. Queue counters are per runtime
  and restart when a saved configuration remounts it.
- The plugin's settings namespace is shared by every DSH profile under the same `DSH_HOME`.
- `V0.4.0_COMPAT_REPORT.md` §28.3 still records the superseded pre-`c9fad0a` archive hash. It was left
  as frozen; the correct figures are in this document.

## Scope not performed

- No development work was redone, and no release source file was modified.
- No further DSH runtime testing was performed, because no release artifact changed.
- The feature branch `feat/v0.4.0-dsh-0.1.7-compat` was kept. It is now identical to `main`.
- `v0.4.1` was not started.
