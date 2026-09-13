# dsh-mail-notify v0.1.0 — Release Report

Phase 5 delivered one thing: the already verified commit `02191a4` was published as the immutable
`v0.1.0`. No feature was added, nothing was refactored, and the SMTP, Credential, runtime adapter,
and test semantics were not touched.

This report records only publicly disclosable facts. It contains no npm token, no GitHub token, no
SMTP credential, and no authorization code.

## Source

```text
release commit  02191a43894f7cf9323641a1d117ae838c4a0c88
version         0.1.0
tag             v0.1.0 (annotated, dereferences to 02191a4)
```

The release invariant was checked before anything else ran: branch `main`, working tree clean,
`HEAD` equal to `02191a4`, `HEAD` in sync with `origin/main` (0 ahead, 0 behind), and no pre-existing
`v0.1.0` tag. The tag was created locally, verified to resolve to `02191a4`, and pushed only after
the npm publish and the registry install both passed. It was never moved, and no history rewriting
command was used.

## Verification

| Check | Result |
| --- | --- |
| `npm run check:text` | PASS — 59 text files, strict UTF-8, BOM-free, no known mojibake |
| `npm run typecheck` | PASS — `tsc --noEmit` over sources and tests |
| `npm test` | PASS — 276 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo |
| `npm run build` | PASS — `tsc -p tsconfig.json` |
| `npm pack` | `dsh-mail-notify-0.1.0.tgz`, 76 entries |
| `npm run pack:check` | PASS — 76 entries, 18 compiled modules, 0 forbidden entries |
| `npm publish --dry-run` | PASS — same name, version, file list, size, shasum, and integrity as the pack audit; no extra file |

The tarball was rebuilt from a clean state before the hash was recorded, and the hash was recorded
once. The published artifact was not modified afterwards.

### Secret scan

Three surfaces were scanned before publishing: the tracked repository (63 tracked files), the packed
archive (76 entries), and the release notes. The patterns covered private-key blocks, AWS access
keys, GitHub and npm tokens, common API-key shapes, assigned `password`/`secret` literals, `AUTH
PLAIN`/`AUTH LOGIN` payloads, long base64 blobs, and 16-digit authorization-code shapes.

Every pattern was clean on all three surfaces. `.env.example` is tracked and carries an empty value
assignment with documentation only. The shipped `cordis.patch.yml` contains no credential value: the
SMTP password is referenced by name through `smtpPasswordCredential` and resolved from the DSH
Credential service at send time. No `.env`, `.credentials.yaml`, or `.npmrc` exists in the repository
or in the archive.

## npm

```text
package   dsh-mail-notify
version   0.1.0
registry  https://registry.npmjs.org/
dist-tag  latest = 0.1.0
```

The name was unclaimed at preflight (`404 Not Found`), so no ownership conflict existed. Publishing
required an interactive one-time password, which the registry enforces for writes; the maintainer
completed that step in a terminal, and the token was never written to the repository.

Post-publish registry verification:

| Field | Published value | Matches local artifact |
| --- | --- | --- |
| `name` | `dsh-mail-notify` | yes |
| `version` | `0.1.0` | yes |
| `dist.shasum` | `aa5ffa36dcd82a417fde53b048c888442c99e347` | yes |
| `dist.integrity` | `sha512-fxKqQMZksE8yet/ymmd+6FcIqd4/bYy2Ol03aLIpNS8h0ulXVNlcut3YzKF58slOWRF5SzunEtnov+LnszwZVQ==` | yes |
| `engines` | `node ^22.19.0 \|\| >=24.0.0` | yes |
| `peerDependencies` | `@deepseek-ai/cordis ^4.0.2`, `@deepseek-ai/dsh-credentials ^0.1.5-rc.1`, `@deepseek-ai/dsh-session ^0.1.5-rc.1`, `@deepseek-ai/schemastery ^3.18.2` | yes |
| `dependencies` | `nodemailer ^7.0.13` | yes |

A clean-room install in an empty directory (`npm install dsh-mail-notify@0.1.0`, 17 packages added)
confirmed that the package installs from the registry and that `lib/index.js`,
`lib/types/index.d.ts`, and `cordis.patch.yml` are present. `require('dsh-mail-notify')` returns the
Cordis plugin shape (`name`, `apply`, `inject`, `Config`). The registry tarball itself was downloaded
and hashed; it is byte-identical to the local artifact.

## GitHub

```text
tag      v0.1.0
release  https://github.com/HaowenCang/dsh-mail-notify/releases/tag/v0.1.0
title    dsh-mail-notify v0.1.0
draft    false
prerelease false
asset    dsh-mail-notify-0.1.0.tgz (78224 bytes)
```

`git ls-remote --tags origin` reports both the annotated tag object and its peeled commit, and the
peeled value is `02191a43894f7cf9323641a1d117ae838c4a0c88`.

The asset was downloaded back from the release and hashed independently.

```text
SHA-256  60ED32A55271AB9462CE7046EDC1E778220295F90B12E996A21AF80932049CF4
SHA-1    aa5ffa36dcd82a417fde53b048c888442c99e347
```

That SHA-256 equals both the local packed artifact and the npm registry artifact. All three
publication surfaces therefore carry exactly the same bytes.

## DSH registry install

A disposable profile (`mn-release-test`) was created and the package was installed **by name from the
registry**, not from the local tarball:

```powershell
dsh plugin --profile mn-release-test add dsh-mail-notify@0.1.0
```

| Expectation | Result |
| --- | --- |
| Plugin listed | `dsh-mail-notify@0.1.0`, 1 package |
| Bundle recognised | `dsh.profile.bundles` became `["@deepseek-ai/dsh-base", "dsh-mail-notify"]` |
| Row composed | `- id: dsh-mail-notify` present in `--dump-config`, with no loader error |
| Inert | `config.enabled: false`, taken from the package's own `cordis.patch.yml` |
| Profile boots | The profile started without error; with the boot probe attached it emitted `INFO dsh-mail-notify plugin.disabled {"reason":"enabled is false"}` |

The probe line is the decisive evidence: the module compiled into the published package was resolved
through the bundle loader, applied in a real composition, and reached its inert early-return branch.
The chain **npm registry → `dsh plugin add` → bundle loader** therefore holds.

The plugin was then removed from the disposable profile and the profile was deleted. The user's `web`
profile was read to confirm it is untouched and was never modified; no mail was sent during this
phase.

## Post-release documentation

The released source commit is fixed at `02191a4`, so the documentation that records the released
state sits in a separate commit on `main` after the tag:

```text
docs: record v0.1.0 release
main > v0.1.0
```

README.md, 00_MASTER.md, this report, and the published release notes were updated in that commit.
The `v0.1.0` tag was not moved and still points at `02191a4`.

## Known limitations

Identical to the published release notes:

1. Deduplication does not survive a process restart: a replayed turn can produce a second message.
2. A mid-turn attach has no recorded start time, so the turn duration is reported as unknown.
3. Some non-`completed` `turn/end` reasons are recognised but not yet live-triggered.
4. When the queue is full the newest notification is refused and is not persisted for retry.
5. A headless profile that exits immediately after a turn completes may end before the asynchronous
   queue sends.
6. Nodemailer 7.0.13 currently carries an audit advisory. Reachability of the affected path for this
   plugin's actual usage was analysed during release-candidate validation; upgrading to 10.x is left
   to a separate version.

This release does not claim support for all DSH versions, zero vulnerabilities, exactly-once
delivery, or guaranteed mailbox delivery.
