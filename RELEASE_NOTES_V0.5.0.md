# Release notes — v0.5.0

This file is the local copy of the GitHub Release body for
[`dsh-mail-notify v0.5.0`](https://github.com/HaowenCang/dsh-mail-notify/releases/tag/v0.5.0).
The release report is [`RELEASE_V0.5.0.md`](RELEASE_V0.5.0.md); the compatibility record is
[`V0.5.0_COMPAT_REPORT.md`](V0.5.0_COMPAT_REPORT.md).

## dsh-mail-notify v0.5.0

DSH 0.2.0-rc.2 — validated

Compatibility is claimed for that harness release only. No broader compatibility is asserted.

`v0.4.0 remains the DSH 0.1.7-rc.2 line.` This release does not extend, replace, or restate that
claim, and it does not claim any harness release after `0.2.0-rc.2`.

### Compatibility

- The package pins its DSH peers exactly: `@deepseek-ai/dsh-credentials` at `0.2.0-rc.2` and
  `@deepseek-ai/dsh-session` at `0.2.0-rc.2`.
- v0.4.0 refused by DSH 0.2 compatibility gate: with the `0.2.0-rc.2` harness, the real plugin
  manager refuses the v0.4.0 archive on its `peerDependencies` gate alone, with no exemption
  available.
- v0.5.0 accepted without exemption: the same plugin manager accepts the v0.5.0 archive, the bundle
  is recognised, and the Host loads it. No `compatibility.json` exemption, no accept-risk path, and
  no peer bypass is involved.

### Timed `ask_user_question`

DSH 0.2 ships a timed question mode alongside the legacy blocking call. All three outcomes are
covered:

- answered before timeout — the in-window answer produces one question mail, and no second mail
  follows.
- timeout → `pending` — when the foreground wait expires, the call settles as `pending`; that
  settlement is not read as an explicit tool error.
- late reply — an answer that arrives after the wait expired produces no second mail and does not
  consume or recreate a question-notification key.

A late reply arrives as `source.kind = user-question-reply`. That kind is not treated as an ordinary
user prompt: it is never attributed as the Turn's operator prompt and never becomes
`includeUserPrompt` content. An ordinary prompt in the same Turn is still attributed normally, which
is the positive control for that rule.

### Privacy

`timeout` and every other tool argument that is not on the allowlist do not enter a mail. The
allowlisted question fields are still carried in full, and no non-allowlisted field reaches a mail
body, a job record, or a log line.

### Config UI

Strictly: **23 Config controls** plus **1 separate write-only password Credential control**. The card
renders 24 labelled controls in total, reported as `config 23/23, credential 1/1` and never as a bare
total. The password is a Credential, not a 24th Config field, and no path reads it back.

The two claims come from two complementary evidence classes and neither substitutes for the other:

- **PAR-01 → Host/Web Config key-set identity.** The unit invariant derives the Host Config field set
  from `Config.toJSON()` and compares it against the card's `ALL_FIELDS` in both directions,
  duplicate detection included. It proves the two field tables agree.
- **browser E2E → rendered-label presence.** The browser harness asserts the expected rendered display
  label for each of the 23 Config controls and for the one separate write-only password Credential
  control. It proves the real page rendered them. The label list is handwritten copy, so it cannot
  see a Host field nobody listed; that is exactly what PAR-01 covers instead.

### Existing privacy defaults

Every switch below ships off, and the shipped profile layer restates them, so notification traffic is
opt-in:

```text
includeSubagents   = false
includeUserPrompt  = false
notifyErrors       = false
notifyQuestions    = false
notifyApprovals    = false
```

### Limitations

- Only DSH 0.2.0-rc.2 is claimed. No other harness release is claimed, before or after it.
- The notification queue is nonpersistent: queued jobs do not survive a restart.
- Deduplication is process-local: it does not span processes or restarts.
- SMTP acceptance is not mailbox delivery. A mail the server accepted may still fail to reach a
  mailbox.
- Question and approval notifications are notification-only.
- There is no action callback: a mail cannot answer a question or decide an approval.
- The timed-question tests are not a timing soak. They assert the three outcomes deterministically;
  they do not measure behaviour under sustained timing load.
- The browser E2E did not spend a real model plan to drive notification. The isolated web profile
  composes the real model provider, so driving a Turn there would spend real quota; the
  notification families are covered by the real-assembly probes instead.

### Artifact

`dsh-mail-notify-0.5.0.tgz` — 203 186 bytes
SHA-256 `7C93BCCF69B4A34E809ED1A046C2F7FD32FFEE873B9A5287663AB660440F59A0`

The same bytes are published to npm and attached to this release.

### Installing

```text
dsh plugin --profile <profile> add dsh-mail-notify@0.5.0
```

The `dsh plugin ... add` command reconciles the package's declared bundle into that profile's
`dsh.profile.bundles` automatically. Restart DSH so the startup-loaded profile applies the new bundle;
configuration is then reachable from Settings → Plugins → dsh-mail-notify.
