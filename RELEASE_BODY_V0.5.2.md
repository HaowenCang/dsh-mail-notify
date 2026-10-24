# dsh-mail-notify v0.5.2

DSH `0.2.1` line — declared host range, verified on `0.2.1-rc.2` and `0.2.1-rc.3`

**Publication status:** this GitHub Release is published with the frozen archive attached. npm
publication is **not** part of this release: the maintainer publishes `dsh-mail-notify@0.5.2` to the
npm registry separately, with interactive 2FA. Until that happens, install from the release asset
below, not from the registry.

The compatibility record for this release is
[`V0.5.2_COMPAT_AUDIT.md`](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.2/V0.5.2_COMPAT_AUDIT.md);
the detailed release notes are
[`RELEASE_NOTES_V0.5.2.md`](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.2/RELEASE_NOTES_V0.5.2.md).
The previous line's record is
[`V0.5.1_COMPAT_REPORT.md`](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.2/V0.5.1_COMPAT_REPORT.md)
and its release-candidate correction is
[`V0.5.1_COMPAT_R1_REPORT.md`](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.2/V0.5.1_COMPAT_R1_REPORT.md).
All repository links in this body resolve to the `v0.5.2` tag.

## Compatibility — the DSH `0.2.1` line

- Minimum supported DSH: **`0.2.1-rc.2`**.
- Declared host range: `engines.dsh: ">=0.2.1-rc.2 <0.2.2-0"`; the
  `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-session` peers carry the same range.
- **Verified hosts: DSH `0.2.1-rc.2` and `0.2.1-rc.3` only**, each re-verified in an isolated host
  (native plugin-manager install of the packed archive with no version exemption, real-assembly
  probes, and the rc.3 browser run).
- The range also *admits* later `0.2.1-*` releases and `0.2.1` final without a new plugin release,
  but those versions are **not tested** and are **not claimed** by this release. No statement is
  made about any version that was not measured.
- `0.2.2` is **not supported**: the upper bound `<0.2.2-0` excludes every `0.2.2` prerelease and
  `0.2.2` itself.

`v0.5.0` remains the DSH `0.2.0-rc.2` line and is not restated here.

### One deliberate compatibility policy change

The only compatibility change in `0.5.2` is the host-range declaration. `0.5.1` pinned the exact
string `0.2.1-rc.2`; that pin cannot admit `0.2.1-rc.3` (the version matrix evaluates the exact pin
as a DSH-gate REJECT on rc.3, and npm returns `ERESOLVE` to a consumer installing it there).

- **`engines.dsh` is now a range.** The package declares `engines.dsh: ">=0.2.1-rc.2 <0.2.2-0"`.
  DSH `0.2.1-rc.2`/`rc.3` read an own `engines.dsh` first and, when it is present, decide admission
  on it alone; the `@deepseek-ai/dsh*` `peerDependencies` check is the fallback, consulted only when
  no `engines.dsh` is declared. The gate file is byte-identical between the two tags.
- **The lower bound is the support floor.** `0.2.1-rc.2` is the minimum supported host;
  `0.2.1-rc.1` and earlier are refused.
- **The upper bound is prerelease-safe.** `<0.2.2-0` excludes every `0.2.2` prerelease (numeric `0`
  sorts below `rc`) and `0.2.2` itself.
- **The two DSH shared-service peers carry the same range.** They remain an instance declaration,
  not a second compatibility range — with `engines.dsh` present the gate does not read them — but
  they carry the range because npm ignores `engines.dsh` and resolves the peers.
- **The DSH gate and npm agree on every tested cell.** The 7-version × 3-range matrix (DSH-gate
  `includePrerelease: true` vs npm-default semantics) produced the same verdict in all 21 cells; the
  npm peer-resolution experiments install cleanly on rc.2 and rc.3 with no peer or engine warning.
- **No `@deepseek-ai/dsh` peer** is added. The plugin imports no host package, and a host-app peer
  would pull the whole DSH application into a consumer's production dependency tree.

## What changed

- **Metadata only.** Version `0.5.2`; `engines.dsh: ">=0.2.1-rc.2 <0.2.2-0"`; the
  `dsh-credentials` / `dsh-session` peers at the same range; all 17 `@deepseek-ai/dsh-*`
  devDependencies moved from `0.2.1-rc.2` to `0.2.1-rc.3`; the lockfile regenerated so its root
  version is `0.5.2` and no `0.2.1-rc.2` dependency pin remains.
- **Build-reproducibility pin.** `package.json` gains `overrides: {"rolldown": "1.2.14"}`. The
  released `0.5.1` client bundle was built with rolldown `1.2.14`; an unpinned lock resolves
  `1.2.15`, which changes only `//#region` comment markers in the emitted bundle. Pinning restores
  byte-identical output. This is a devDependency-resolution pin only: it is never installed by a
  consumer and has no runtime or peer effect.
- **No production change.** All 109 files under `lib/**` (including all 26 executable `.js` files)
  are byte-identical to the released `v0.5.1` archive; no file under `src/**` changed. The
  `rc.2`→`rc.3` source diff found no host surface this plugin uses changed.

## What did not change

- Notification behaviour: the three families (settled Turn, terminal failure, mid-turn
  human-attention), their policy switches, subjects, bodies and privacy defaults are unchanged.
- The configuration surface is still **23 Config fields plus 1 separate write-only Credential
  control**; the card neither gained nor lost a field.
- The **credential path** is unchanged: one named `CredentialRef`, resolved through the Credential
  service once per send attempt, never cached, never logged. On the `0.2.1` line the provider
  resolves the managed store first, then the inherited environment, then the `.env` fallbacks; the
  credential packages are source-identical between `0.2.1-rc.2` and `0.2.1-rc.3`.
- The **Test Email** path is unchanged: it uses the same credential lookup, transport construction,
  and failure classification as a real notification.
- Deduplication semantics (process-local, three namespaces), the nonpersistent queue, and the
  timed-question handling are unchanged.
- No new runtime dependency. Nodemailer `10.x` remains the only one.
- A one-shot `headless` profile still has no managed credential store: a credential-referenced SMTP
  password there must be restored at the profile level, exactly as documented for `0.5.1`. This is a
  host-profile behaviour with a host-documented remedy, not a plugin defect.

## Host behaviours on the DSH `0.2.1` line worth knowing

These were established on `0.2.1-rc.2` and the relevant host packages are byte-identical in
`0.2.1-rc.3`; the runtime record is the audit report.

- **Credential read priority is store-first.** The file-backed provider prefers the managed store
  over the inherited process environment, and `describe().writable` is `true` for
  environment-sourced references too. The plugin is priority-agnostic: it resolves one named
  reference per send attempt and treats the provider's answer as authoritative.
- **One-shot `headless` profiles disable the managed credential store.** `credentials`,
  `authorization` and `deepseek-account` are `disabled: true` for one-shot jobs. On a stock one-shot
  profile a `CredentialRef` cannot resolve: the plugin refuses to send and reports
  `credential-missing` rather than failing open or sending unauthenticated. The remedy is the
  host-documented profile change (restore the three rows per the `dsh-headless` README's Credentials
  section). Supplying the SMTP password only through the launch environment does **not** fix this:
  that fallback serves DSH's own model API-key routes, while this plugin resolves its
  `smtpPasswordCredential` reference only through the Credential service. Web and desktop profiles
  keep the credential service and are unaffected.
- **HMR is rewritten.** Replacing installed package code stops the affected Loader entries and
  restarts them; a stop runs the fiber's disposers, which is where this plugin releases its
  listeners, queue and timers. The plugin's lifecycle contract is unchanged.

## Verification

Verification for this release was performed by the compatibility phase and is recorded in
[`V0.5.2_COMPAT_AUDIT.md`](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.2/V0.5.2_COMPAT_AUDIT.md).
The release/publishing phase itself did **not** re-run the suite, rebuild, or repack; it verified the
frozen archive's size and hashes and published it unchanged.

The certified candidate archive differs from the pre-docs v1 tree only by the in-package
`README.md`; `package.json`, the lockfile, `lib/**`, `tests/**` and the toolchain are unchanged. So
the packaging-related gates were re-run on the final archive, while the build and test suite were
run on the pre-docs tree whose `lib/**` is byte-identical and whose `package.json` is unchanged.

Automated gates recorded by the compatibility phase:

- `npm run check:text` — PASS, every scanned text file strict UTF-8, BOM-free, free of known
  mojibake (re-run on the final archive).
- `npm run typecheck` — PASS, all three programs, both compatibility compile probes.
- `npm run build` — PASS; `lib/client.js` 68.88 kB, the same bytes as the released `0.5.1` archive.
- `npm test` — **581 tests, 581 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**, including the
  isolated credential-precedence test.
- `npm run pack:check` — PASS on the final archive; required entries present, no forbidden entry.
- `npm run scan:secrets` — PASS on the final archive; credential-value hits 0, shaped-literal hits 0.
- `npm audit --omit=dev` — 0 production vulnerabilities.
- `git diff --check` — clean.
- Executable-bytes comparison — 109/109 `lib/**` files identical to the released `v0.5.1` archive,
  26/26 executable `.js` files identical.

Runtime verification on isolated DSH `0.2.1-rc.2` and `0.2.1-rc.3` hosts, with a disposable
`DSH_HOME`, no version exemption, loopback SMTP and synthetic credentials, is recorded in
[`V0.5.2_COMPAT_AUDIT.md`](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.2/V0.5.2_COMPAT_AUDIT.md):
the rc.2 regression gate (32/32 checks PASS), the rc.3 real-assembly gates, the live-policy and
config-write probes, and a real-Chrome rc.3 Web UI run. That report is the authority for the
measured runtime results.

## Artifact

| Metric | Value |
| --- | --- |
| File | `dsh-mail-notify-0.5.2.tgz` |
| Size | **205 985 B** |
| Entries | **113** |
| SHA-256 | **`0A21E750FE32B47C0BDCB1F8C9500A6A3597373092BD4E6E376C2D76F08FFF76`** |
| npm SHA-512 integrity | `sha512-yfFryiga8SfHU1fKkfOjgmpCVjxsiUj25z6vxR4vYpNIsadwnhuKZCxT/9FsPhXy6hRm6f6t4Y0UggzfevksPw==` |
| Reproducible | yes — two independent `npm pack` runs produced identical bytes |
| Executable content | all 109 `lib/**` files (26/26 `.js`) byte-identical to the released `v0.5.1` archive |

The asset attached to this release is that exact frozen archive, byte-for-byte. It is the certified
candidate; the pre-docs v1 candidate `53FC7DC8…2F25` is superseded, preserved only as a named
executable-identity reference, and is not published. Packaging evidence: `_phase052-compat/build/`
(`artifact-0.5.2.json`, `artifact-comparison.json`, `LIB_HASH_COMPARISON.md`, `ARTIFACT.md`,
`GATES.md`, `logs/`). Those paths are local phase evidence outside the repository and are not
downloadable links.

## Upgrade notes

- On a DSH `0.2.1-rc.2` or `0.2.1-rc.3` host, install `0.5.2`. From this release: download
  `dsh-mail-notify-0.5.2.tgz` and add that archive to the profile. From the registry, once the
  maintainer has published the npm version:
  `dsh plugin --profile <profile> add dsh-mail-notify@0.5.2`.
- Do **not** expect `0.5.2` to be admitted by a DSH `0.2.0-rc.2` host: that generation reads only
  the DSH peers, which no longer name its release line. Keep `v0.5.0` for that line.
- Do **not** expect `0.5.2` to be admitted by a DSH `0.2.2` host: the declared upper bound excludes
  that line.
- A host upgraded from `0.2.0-rc.2` must keep the store-first credential order in mind: a same-named
  value in `$DSH_HOME/.credentials.yaml` now overrides the environment.
- On a one-shot `headless` profile, restore the `credentials` / `authorization` /
  `deepseek-account` rows before configuring the SMTP password as a `CredentialRef`; otherwise the
  plugin correctly reports `credential-missing` and sends nothing.
- `0.5.1` and its published artifacts, GitHub Release and tag are unchanged and immutable.

## Limitations

- Only DSH `0.2.1-rc.2` and `0.2.1-rc.3` are claimed. `0.2.1-rc.4`, `0.2.1` final and any future
  `0.2.1-*` release are admitted by the range but untested and not claimed; `0.2.2` is not supported.
- The notification queue is nonpersistent: queued jobs do not survive a restart or an HMR
  stop/start of the plugin.
- Deduplication is process-local: it does not span processes or restarts.
- SMTP acceptance is not mailbox delivery. A mail the server accepted may still fail to reach a
  mailbox.
- Question and approval notifications are notification-only; there is no action callback, so a mail
  cannot answer a question or decide an approval.
- The timed-question tests are not a timing soak; they assert the three outcomes deterministically.
- The browser run does not spend a real model plan; the notification families are covered by the
  real-assembly probes, whose only substitutions are the model's tokens, the human, and the SMTP
  peer's identity.
- The tag↔npm-artifact link for either DSH release is supplied, not derived: the npm packages carry
  no `gitHead`. The measured facts are the runtime version string and the installed package
  versions.

## Status

```text
GITHUB RELEASE   PUBLISHED — formal, not prerelease, not draft, marked latest
GIT TAG          v0.5.2 — annotated, points at the PR #2 merge commit
MAIN             MERGED — the release source is the PR #2 merge commit
NPM              NOT PUBLISHED — maintainer publishes 0.5.2 separately with interactive 2FA
```

Release source: the merge commit of
[PR #2](https://github.com/HaowenCang/dsh-mail-notify/pull/2) (`dab495da9f59e9a77f5153b060e0ae1db8008b44`),
whose tree is identical to the `compat/dsh-0.2.1-rc.3` head `b3d1600`. The annotated tag object
targets that commit, and the GitHub release asset is the frozen archive whose size and hashes are
listed above.
