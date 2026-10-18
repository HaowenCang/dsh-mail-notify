# Release notes — v0.5.1

**Release candidate — not published, no tag.** These are the candidate release notes for
`dsh-mail-notify` `v0.5.1`. Unlike [`RELEASE_NOTES_V0.5.0.md`](RELEASE_NOTES_V0.5.0.md), this file is
not a copy of a GitHub Release body: no `v0.5.1` npm version, git tag, or GitHub Release exists at the
time of writing, and none will be created in this phase. The compatibility record is
[`V0.5.1_COMPAT_REPORT.md`](V0.5.1_COMPAT_REPORT.md); the host-side evidence is
[`docs/compat/01_CONTRACT_DIFF.md`](docs/compat/01_CONTRACT_DIFF.md) and the plugin-side evidence is
[`docs/compat/02_PLUGIN_USAGE_AUDIT.md`](docs/compat/02_PLUGIN_USAGE_AUDIT.md).

## dsh-mail-notify v0.5.1

DSH 0.2.1-rc.2 — declared and verified (release candidate)

Compatibility is claimed for that harness release only. No broader compatibility is asserted.

`v0.5.0` remains the DSH `0.2.0-rc.2` line. This release does not extend, replace, or restate that
claim, and it does not claim any harness release other than `0.2.1-rc.2`.

### Compatibility

- **`engines.dsh` is the host-range declaration.** The package declares `engines.dsh: "0.2.1-rc.2"`,
  exactly. DSH `0.2.1-rc.2` reads an own `engines.dsh` first and, when it is present, decides
  admission on it alone; the `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` `peerDependencies` check is its
  fallback and is consulted only when no `engines.dsh` is declared
  (`docs/compat/01_CONTRACT_DIFF.md` §1).
- **The shared-instance peers are exact too.** `@deepseek-ai/dsh-credentials` and
  `@deepseek-ai/dsh-session` stay pinned to `0.2.1-rc.2`. They name the service instance the plugin
  resolves through and the declarations it type-imports; with `engines.dsh` present the gate does not
  read them, so they are an instance declaration and not a second compatibility range.
- **No `@deepseek-ai/dsh` peer.** The plugin imports no host package, and upstream DSH 0.2.1's
  plugin-authoring guide designates `engines.dsh` as the host-range mechanism with DSH peers as its
  fallback; a root host peer would also pull the entire DSH application into a consumer's production
  dependency tree.
- **`v0.5.0` is not re-declared for the new host.** It carries no `engines.dsh`, so `0.2.1-rc.2`
  falls back to its peers, which pin `0.2.0-rc.2` and do not match — exactly the refusal path the
  source diff records for the baseline release (`docs/compat/01_CONTRACT_DIFF.md` §10). Install
  `0.5.1` for a `0.2.1-rc.2` host.

### What changed

- **Metadata.** Version `0.5.1`; `engines.dsh: "0.2.1-rc.2"`; `dsh-credentials` / `dsh-session`
  peers at `0.2.1-rc.2`; all 15 `@deepseek-ai/dsh-*` devDependencies at `0.2.1-rc.2`; the
  host-installed `@deepseek-ai/cordis` `4.0.5` and `@deepseek-ai/schemastery` `3.18.5`; the lockfile
  regenerated so no `0.2.0-rc.2` entry remains.
- **Contract probe.** DSH `0.2.1-rc.2` removed `ConfigFormSnapshot.mode` together with the client
  memory persistence mode. `tests/compatibility/contracts.compile.ts` now pins the six remaining
  snapshot fields and states the removal as a checked `@ts-expect-error`, so a reintroduction fails
  the build instead of silently returning to the API.
- **Text gate scope.** `scripts/check-text-integrity.mjs` skips the gitignored `tmp/` scratch tree, so
  the gate audits tracked sources rather than a previous session's copied files.

### What did not change

- Notification behaviour: the three families (settled Turn, terminal failure, mid-turn
  human-attention), their policy switches, subjects, bodies and privacy defaults are unchanged.
- The configuration surface is still **23 Config fields plus 1 separate write-only Credential
  control**; the card neither gained nor lost a field.
- Deduplication semantics (process-local, three namespaces), the nonpersistent queue, and the
  timed-question handling (timeout `pending` is a non-error result; a late `user-question-reply` is
  never the operator prompt) are unchanged.
- The plugin's used host surfaces are unchanged between the two tags: every session-event payload the
  adapter reads, `SessionHeader` and `source.kind`, `loader/volatile-update`, and the two `/api`
  exact routes are source-identical or additively compatible
  (`docs/compat/01_CONTRACT_DIFF.md` §2, §4, §7, §8).
- No new runtime dependency. Nodemailer `10.x` remains the only one.

### Host behaviours on DSH 0.2.1-rc.2 worth knowing

- **Credential read priority is inverted.** The file-backed provider now prefers the managed store
  over the inherited process environment, and `describe().writable` is `true` for environment-sourced
  references as well (`docs/compat/01_CONTRACT_DIFF.md` §3). The plugin is priority-agnostic — it
  resolves one named reference per send attempt and treats the provider's answer as authoritative — so
  no code change was needed, but which stored value wins for a reference present in more than one
  layer is now the host's choice, and a previously read-only environment reference becomes editable
  in the card.
- **HMR is rewritten.** Replacing installed package code now stops the affected Loader entries and
  restarts them (with a `restartReason` vocabulary) instead of requiring a restart for package
  versions (`docs/compat/01_CONTRACT_DIFF.md` §1.5–§1.6). The plugin keeps every listener and the
  queue on its own fiber, so one teardown followed by one re-subscription is the expected shape; the
  duplicate-listener/duplicate-send check remains a runtime-verification item
  (`docs/compat/01_CONTRACT_DIFF.md` §12).
- **One-shot `headless` profiles disable the managed credential store.** The shipped `headless`
  bundle marks `credentials`, `authorization` and `deepseek-account` as `disabled: true` for one-shot
  jobs (`packages/bundle/headless/cordis.patch.yml` at tag `dsh-v0.2.1-rc.2`; DSH `0.2.0-rc.2` did
  not). This was confirmed on the real `0.2.1-rc.2` host during verification. On a stock one-shot
  profile a `CredentialRef` cannot resolve: the plugin refuses to send and reports
  `credential-missing` rather than failing open or sending unauthenticated. The remedy is a profile
  change documented by the host: restore the three rows per the `dsh-headless` README's Credentials
  section. Supplying the SMTP password only through the launch environment does **not** fix this
  plugin: the host's headless environment fallback serves DSH's own model API-key routes, while this
  plugin resolves its `smtpPasswordCredential` reference only through the Credential service; with
  `credentials` disabled there is no service to call. Web and desktop profiles keep the credential
  service and are unaffected. This is a host-behaviour change with a documented remedy, not a plugin
  defect.

### Verification

Recorded on the `0.2.1-rc.2` dependency set:

- `npm run typecheck` — PASS, all three programs, both compatibility compile probes.
- `npm test` — **580 tests, 580 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**, including the
  isolated credential-conflict test (real `0.2.1-rc.2` provider, file value A vs inherited
  environment value B; precedence, fallback and rotation asserted separately).
- `npm run build` — PASS.
- `npm audit --omit=dev` — 0 vulnerabilities.

Runtime verification on a real, isolated DSH `0.2.1-rc.2` host (no version exemption) is recorded in
[`V0.5.1_COMPAT_REPORT.md`](V0.5.1_COMPAT_REPORT.md), written after the runtime pass completes: the
real-assembly probes, the live-policy and Host config-write probes, the schema/volatile/config-check
probes, a browser run against a disposable profile, and a real plugin-manager installation of the
packed archive. The probe overlays restore the `headless` credential rows described above, because a
stock one-shot profile intentionally has no credential store to resolve against.

### Upgrade notes

- Install `0.5.1` on a DSH `0.2.1-rc.2` host:
  `dsh plugin --profile <profile> add dsh-mail-notify@0.5.1` (from the registry once published; from
  the packed archive while this is a release candidate).
- Do **not** expect `0.5.1` to be admitted by a DSH `0.2.0-rc.2` host: `engines.dsh` declares
  `0.2.1-rc.2` only, and that generation has no `engines.dsh` rule to read (it reads only the DSH
  peers, which are pinned to `0.2.1-rc.2`). Keep `v0.5.0` for the `0.2.0-rc.2` line.
- On a one-shot `headless` profile, restore the `credentials` / `authorization` /
  `deepseek-account` rows before configuring the SMTP password as a `CredentialRef`; otherwise the
  plugin correctly reports `credential-missing` and sends nothing.
- `v0.5.0` is unchanged and immutable: its published artifact, tag and compatibility claim are not
  moved or restated by this release.

### Limitations

- Only DSH `0.2.1-rc.2` is claimed by `0.5.1`; `0.5.0` remains the `0.2.0-rc.2` release. No other
  harness release is claimed.
- The notification queue is nonpersistent: queued jobs do not survive a restart or an HMR
  stop/start of the plugin.
- Deduplication is process-local: it does not span processes or restarts.
- SMTP acceptance is not mailbox delivery. A mail the server accepted may still fail to reach a
  mailbox.
- Question and approval notifications are notification-only; there is no action callback, so a mail
  cannot answer a question or decide an approval.
- The timed-question tests are not a timing soak; they assert the three outcomes deterministically.
- The browser run did not spend a real model plan to drive a notification; the notification families
  are covered by the real-assembly probes instead.

### Status

```text
RELEASE CANDIDATE
NOT PUBLISHED
NOT TAGGED
NO GITHUB RELEASE
```

No artifact size or hash is recorded in these notes: they precede packing and publication. The
archive used for the verification run is recorded in
[`V0.5.1_COMPAT_REPORT.md`](V0.5.1_COMPAT_REPORT.md).
