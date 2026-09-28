# Release notes — v0.4.0

This file is the local copy of the GitHub Release body for
[`dsh-mail-notify v0.4.0`](https://github.com/HaowenCang/dsh-mail-notify/releases/tag/v0.4.0).
The release report is [`RELEASE_V0.4.0.md`](RELEASE_V0.4.0.md); the compatibility record is
[`V0.4.0_COMPAT_REPORT.md`](V0.4.0_COMPAT_REPORT.md).

## dsh-mail-notify v0.4.0

DSH 0.1.7-rc.2 — validated

Compatibility is claimed for that harness release only. No broader compatibility is asserted.

### Configuration now lives in the native volatile Config

The plugin's Host configuration is declared through its native volatile Cordis `Config`. The browser
obtains that bundle configuration through `ctx.configForms` and renders it in the
`plugins.bundle.config` slot. A form mutation commits the profile-layer configuration; the Loader
updates the volatile references and emits `loader/volatile-update`, and the runtime is rebuilt from a
fresh snapshot. A switch flipped in the Web UI therefore takes effect without restarting DSH. A
configuration that fails validation never replaces one that works: the refusal is logged and reported
to the Web UI while the previous runtime keeps running.

### Web configuration surface

- 23 Config controls, plus 1 write-only Credential control for the SMTP password. The password is
  never a Config value and no path reads it back.
- Host pre-persistence Standard Schema product validation refuses an inconsistent document before it
  is written, so a rejected save leaves both the profile file and the running plugin untouched.
- The card shows the effective value of every field, the live status of the runtime, and the
  effective state of the question and approval switches.

### Notification behaviour

- Direct-human prompt attribution is decided by `source.kind === 'user'`. Injected runtime context,
  skills, goals, agent instructions, and agent-to-agent messages are excluded whatever their text.
- A user fork is distinguished from a subagent, so a forked turn is classified as `forked` rather
  than being mistaken for agent-to-agent traffic.
- Completed-turn and max-token notifications.
- Terminal errors, including a failure that produced no visible output — the one case where a message
  is sent without a body of assistant text.
- Question notifications when the agent is waiting on input.
- Approval notifications when the agent is waiting on an approval decision.
- An approval mail carries the tool name and the request's own reason text. Approval ids, call ids,
  tool arguments, reasoning, and credential values are not sent.

### Privacy defaults

Every switch below ships off, and the shipped profile layer restates them, so notification traffic is
opt-in:

```text
includeSubagents   = false
includeUserPrompt  = false
notifyErrors       = false
notifyQuestions    = false
notifyApprovals    = false
```

### Artifact

`dsh-mail-notify-0.4.0.tgz` — 201 918 bytes
SHA-256 `CE185447466FDC8AA908E37F937FE2003BCC956E3FC681D968E6FCCDFA22FB78`

The same bytes are published to npm and attached to this release.

### Installing

```text
dsh plugin --profile <profile> add dsh-mail-notify@0.4.0
```

The `dsh plugin ... add` command reconciles the package's declared bundle into that profile's
`dsh.profile.bundles` automatically. Restart DSH so the startup-loaded profile applies the new bundle;
configuration is then reachable from Settings → Plugins → dsh-mail-notify.
