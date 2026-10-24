# Release notes — v0.5.2

**Release candidate — not published, no tag.** These are the candidate release notes for
`dsh-mail-notify` `v0.5.2`. No `v0.5.2` npm version, git tag, or GitHub Release exists at the time of
writing, and none is created in this phase. `0.5.1` remains the latest released version; nothing in
this phase was published.

The compatibility record for this candidate is [`V0.5.2_COMPAT_AUDIT.md`](V0.5.2_COMPAT_AUDIT.md).
The previous line's record is [`V0.5.1_COMPAT_REPORT.md`](V0.5.1_COMPAT_REPORT.md) and its
release-candidate correction is [`V0.5.1_COMPAT_R1_REPORT.md`](V0.5.1_COMPAT_R1_REPORT.md).

## dsh-mail-notify v0.5.2

DSH `0.2.1` line — declared range, two verified hosts (release candidate)

- Minimum supported DSH: **`0.2.1-rc.2`**.
- Declared host range: `engines.dsh: ">=0.2.1-rc.2 <0.2.2-0"`; the
  `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-session` peers carry the same range.
- Verified hosts: **DSH `0.2.1-rc.2` and `0.2.1-rc.3`**, each re-verified in an isolated host in
  this phase (native plugin-manager install with no version exemption, real-assembly probes, and the
  rc.3 browser run).
- Later `0.2.1-*` releases and `0.2.1` final are **admitted** by the range without a new plugin
  release, but they are **not tested** and are not claimed.
- `0.2.2` is **not supported**.

`v0.5.0` remains the DSH `0.2.0-rc.2` line and is not restated here.

### Compatibility — one deliberate policy change

The only compatibility change in `0.5.2` is the host-range declaration. `0.5.1` pinned the exact
string `0.2.1-rc.2`; that pin cannot admit `0.2.1-rc.3` (the version matrix evaluates the exact pin
as a DSH-gate REJECT on rc.3, and npm returns `ERESOLVE` to a consumer installing it there).

- **`engines.dsh` is now a range.** The package declares `engines.dsh: ">=0.2.1-rc.2 <0.2.2-0"`.
  DSH `0.2.1-rc.2`/`rc.3` read an own `engines.dsh` first and, when it is present, decide admission
  on it alone; the `@deepseek-ai/dsh*` `peerDependencies` check is the fallback, consulted only when
  no `engines.dsh` is declared. The gate file is byte-identical between the two tags.
- **The lower bound is the support floor.** `0.2.1-rc.2` is the minimum supported host; `0.2.1-rc.1`
  and earlier are refused.
- **The upper bound is prerelease-safe.** `<0.2.2-0` excludes every `0.2.2` prerelease (numeric `0`
  sorts below `rc`) and `0.2.2` itself. The `0.2.2` line is not supported.
- **The two DSH shared-service peers carry the same range.** They remain an instance declaration,
  not a second compatibility range — with `engines.dsh` present the gate does not read them — but
  they carry the range because npm ignores `engines.dsh` and resolves the peers.
- **The DSH gate and npm agree on every tested cell.** The 7-version × 3-range matrix (DSH-gate
  `includePrerelease: true` vs npm-default semantics) produced the same verdict in all 21 cells; the
  npm peer-resolution experiments install cleanly on rc.2 and rc.3 with no peer or engine warning.
- **No `@deepseek-ai/dsh` peer** is added. The plugin imports no host package, and a host-app peer
  would pull the whole DSH application into a consumer's production dependency tree.

### What changed

- **Metadata only.** Version `0.5.2`; `engines.dsh: ">=0.2.1-rc.2 <0.2.2-0"`; the
  `dsh-credentials` / `dsh-session` peers at the same range; all 17 `@deepseek-ai/dsh-*`
  devDependencies moved from `0.2.1-rc.2` to `0.2.1-rc.3`; the lockfile regenerated so its root
  version is `0.5.2` and no `0.2.1-rc.2` dependency pin remains.
- **Build-reproducibility pin.** `package.json` gains
  `overrides: {"rolldown": "1.2.14"}`. The released `0.5.1` client bundle was built with rolldown
  `1.2.14`; an unpinned lock resolves `1.2.15`, which changes only `//#region` comment markers in
  the emitted bundle. Pinning restores byte-identical output. This is a devDependency-resolution pin
  only: it is never installed by a consumer and has no runtime or peer effect.
- **No production change.** All 109 files under `lib/**` (including all 26 executable `.js` files)
  are byte-identical to the released `v0.5.1` archive; no file under `src/**` changed. The
  `rc.2`→`rc.3` source diff found no host surface this plugin uses changed.

### What did not change

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

### Host behaviours on the DSH `0.2.1` line worth knowing

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

### Verification

The certified candidate (v2, see *Artifact* below) differs from the pre-docs v1 tree only by the
in-package `README.md`; `package.json`, the lockfile, `lib/**`, `tests/**` and the toolchain are
unchanged. So the packaging-related gates were re-run on v2, while the build and test suite below
were run on the pre-docs tree whose `lib/**` is byte-identical and whose `package.json` is unchanged.
That is the exact scope; no code or test gate is claimed to have been re-executed for the
documentation-only change.

Automated gates:

- `npm run check:text` — PASS, every scanned text file strict UTF-8, BOM-free, and free of known
  mojibake (re-run on v2).
- `npm run typecheck` — PASS, all three programs, both compatibility compile probes.
- `npm run build` — PASS; `lib/client.js` 68.88 kB, the same bytes as the released `0.5.1` archive.
- `npm test` — **581 tests, 581 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**, including the
  isolated credential-precedence test (precedence, fallback and rotation asserted separately against
  the installed `0.2.1-rc.3` provider).
- `npm run pack:check` — PASS on v2; the archive's required entries are present and no forbidden
  entry is.
- `npm run scan:secrets` — PASS on v2; credential-value hits 0, shaped-literal hits 0.
- `npm audit --omit=dev` — 0 production vulnerabilities.
- `git diff --check` — clean (also re-run on v2).
- Executable-bytes comparison — 109/109 `lib/**` files identical to the released `v0.5.1` archive,
  26/26 executable `.js` files identical.

Runtime verification on isolated DSH `0.2.1-rc.2` and `0.2.1-rc.3` hosts, with a disposable
`DSH_HOME`, no version exemption, loopback SMTP and synthetic credentials, is recorded in
[`V0.5.2_COMPAT_AUDIT.md`](V0.5.2_COMPAT_AUDIT.md). That report is the authority for the measured
runtime results; these notes do not restate numbers it does not contain.

### Artifact

| Metric | Value |
| --- | --- |
| File | `dsh-mail-notify-0.5.2.tgz` |
| Size | **205 985 B** |
| Entries | **113** |
| SHA-256 | **`0A21E750FE32B47C0BDCB1F8C9500A6A3597373092BD4E6E376C2D76F08FFF76`** |
| npm SHA-512 integrity | `sha512-yfFryiga8SfHU1fKkfOjgmpCVjxsiUj25z6vxR4vYpNIsadwnhuKZCxT/9FsPhXy6hRm6f6t4Y0UggzfevksPw==` |
| Reproducible | yes — two independent `npm pack` runs produced identical bytes |
| Executable content | all 109 `lib/**` files (26/26 `.js`) byte-identical to the released `v0.5.1` archive |

Relative to the released v0.5.1 archive, **111 of 113 entries are byte-identical**; the two intended
changes are `package/package.json` (the declaration policy) and `package/README.md` (the
documentation policy). The pre-docs candidate
`53FC7DC8…2F25` is superseded but preserved as the named executable-identity reference; it is not
the candidate and is not published. Evidence:
`_phase052-compat/build/artifact-0.5.2.json`, `artifact-comparison.json`,
`artifact-v2-vs-53fc.json`, `LIB_HASH_COMPARISON.md`, `ARTIFACT.md`, `GATES.md` and `logs/`
(relative to `_phase052-compat\`).

### Upgrade notes

- On a DSH `0.2.1-rc.2` or `0.2.1-rc.3` host, install `0.5.2`:
  `dsh plugin --profile <profile> add dsh-mail-notify@0.5.2` (from the registry once published; from
  the packed archive while this is a release candidate).
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

### Limitations

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

### Status

```text
RELEASE CANDIDATE
NOT PUBLISHED
NOT TAGGED
NO GITHUB RELEASE
NOT MERGED TO MAIN
```

The certified candidate artifact is `dsh-mail-notify-0.5.2.tgz`, 205 985 B, 113 entries, SHA-256
`0A21E750FE32B47C0BDCB1F8C9500A6A3597373092BD4E6E376C2D76F08FFF76`; its runtime evidence and the
full compatibility record are in [`V0.5.2_COMPAT_AUDIT.md`](V0.5.2_COMPAT_AUDIT.md). The phase
performed no npm publish, no git tag, no GitHub Release and no `main` merge. The pre-docs candidate
`53FC7DC8…2F25` is preserved only as the named executable-identity reference and must not be
presented as the release artifact.
