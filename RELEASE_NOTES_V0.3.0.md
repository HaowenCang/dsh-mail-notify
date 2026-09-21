# Release notes — v0.3.0

## What this release adds

A configuration surface in the DSH Web UI. `Settings → Plugins → Plugin configuration` now shows a
**dsh-mail-notify** card, so the plugin can be configured entirely in the browser instead of by
editing `cordis.patch.yml`.

This release contains **no change to the notification engine's behaviour**: the same listeners, the
same policy, the same rendering, and the same credential and transport path. The defaults are
unchanged, including the two secure ones — `notifyQuestions` and `notifyApprovals` remain `false`.

## How it works

**Host half.** The plugin registers the settings namespace `dsh-mail-notify` through the installed
DSH settings API (`ctx.settings.installSection`), with the composition entry as the namespace's base
layer. Changes to the user document are applied by re-resolving configuration and remounting the
runtime when — and only when — the resolved configuration actually changed.

**Client half.** `exports["./client"]` publishes one self-contained lazy-CJS bundle, declared to the
module system through `dsh.client: { platform: "web" }`. It registers a card into the
`settings.plugin.item` slot under the key `dsh-mail-notify`. At runtime the bundle requires exactly
`react` and `react/jsx-runtime`, both supplied by the shell's seed module table; it shares the
shell's single React instance and ships no second copy.

## Configuration precedence

```
schema defaults  →  cordis.patch.yml (composition)  →  settings.yaml (user overrides)  →  what runs
```

Patch-file configuration keeps working and composes with the card: patch values are the composition
layer, and card values are overrides on top of them. Nothing is migrated automatically, and the
existing patch is not rewritten.

**Reset means unset.** The card marks a field `inherited` or overridden by the *presence* of a
user-layer entry, never by comparing values — an override equal to the composition default is still
an override. Reset removes that entry, so the field re-inherits the composition layer again.

## Two different "enabled" states

The card does not replace the bundle row, and the two switches are independent. Turning the card on
does not load a plugin the profile has not installed, and installing the bundle does not start the
mail path.

| State | Where it lives | What it controls |
| --- | --- | --- |
| Bundle/row enabled | the profile's own `cordis.patch.yml`, or the row the package ships (`enabled: false`) | whether the plugin is loaded at all. With `enabled: false` the plugin short-circuits inside `apply()` before creating any resource: no listener, no queue, no credential read. |
| `dsh-mail-notify` `config.enabled` | the card, i.e. the user layer in `settings.yaml` | whether a *loaded* plugin sends. `false` keeps the runtime mounted and the counters accumulating, but delivers nothing. |

Stopping all sending therefore has two routes with different footprints: `config.enabled: false`
keeps the plugin resident and silent, while a row-level `enabled: false` removes the runtime
entirely. Neither one is implied by the other.

## Credential handling

The browser never reads the SMTP password. The card uses only the three operations the installed
credentials namespace publishes — `describe`, `set`, `unset` — and that namespace has no read path.
The password field starts blank, a stored password is reported only as *configured*, replacement is
write-only, and a successful save clears the local draft. The password never enters the settings
document, a log line, a snapshot, a response, or a test fixture. A custom `smtpPasswordCredential`
reference is preserved.

## Delivery test

**Send test email** on the card delivers one fixed message through the same credential resolution,
transport construction, and failure classification a real notification uses. It reports only a
boolean, a recipient count, and an already-redacted diagnostic; it echoes no recipient address and
no configured value.

## Upstream compatibility

Target and verification baseline: **`@deepseek-ai/dsh@0.1.5-rc.2`**.

This release requires **no change to DSH**. Two capabilities the original design assumed turned out
to be unavailable in this release, and the implementation routes around both:

- `HostConnectionRpc.intercept('/api', …)` admits exactly one interceptor per shared channel, and
  `/api` is already claimed by the Typert gateway. The two Web endpoints are therefore published as
  exact Fetch routes under `/api`, which the shared handler consults *before* the interceptor, and
  which still sit behind `/api`'s Host/Origin trust fence and browser-session authentication.
- `HostConnectionRpc.handle('/<channel>', …)`, the documented route for a plugin-owned channel,
  fails in this release with `cannot get property "webServer" without inject` because it reads
  `owner.webServer` from the *providing* plugin's context. No plugin can use it here.

The client contract graph is pinned to exact `0.1.5-rc.2` releases. Every one of those packages is
published, but several have `dist-tags.latest` pointing at an older release family, so an unpinned
install resolves a client family that disagrees about `SlotMap` and about the renderer's slot
contract. See `CLIENT_RUNTIME_RESOLUTION.md` for the full resolution map, including the evidence
that no stale release family reaches the tested path.

## Verification performed

- `npm run check:text`, `npm run typecheck` (three separate compilation programs), `npm test`
  (451 tests), `npm run build`, `npm pack`.
- Tarball inspection: the declared `./client` export resolves inside the unpacked archive, the
  bundle opens the loader envelope with the package id, contains no top-level ESM statement, and
  requires nothing outside the shell's seed table.
- Install into a disposable DSH `0.1.5-rc.2` profile created from the shipped web template:
  `dsh.client` discovery, `settings.plugin.item` registration with key `dsh-mail-notify`, and the
  card rendering in `Settings → Plugins → Plugin configuration`.
- A real `ask_user_question` turn in that profile, with `notifyQuestions` enabled: the question
  notification was delivered through the production SMTP path and the card's live queue counter
  reflected it.
- Settings persistence in `settings.yaml`, per-field and whole-form reset semantics, and live
  application without a restart.
- **Send test email** delivering through the same credential resolution, transport construction, and
  failure classification a real notification uses.
- The credential boundary observed in the browser: the password field starts blank, a stored password
  is reported only as *configured*, and no endpoint the client calls returns the value.
- A real `ask_user_question` turn with `notifyQuestions` disabled, confirming no question
  notification is produced on the off path.
- No modification to DSH was required for any of the above; the installed `0.1.5-rc.2` tree was used
  as shipped.

Headless operation is unaffected by this release: the plugin still mounts and notifies with no Web
client present, because the client half is an optional `exports["./client"]` entry rather than a
prerequisite for the host half.

## Known limitations

- The card's status line polls every five seconds while it is on screen; the host pushes none of
  those facts.
- The queue counters are per runtime, so they restart from zero when a saved configuration causes
  the runtime to be remounted.
- A configuration that fails field-level validation is refused rather than partially applied: the
  previously running configuration stays in effect and the card reports the reason.
- The plugin's settings namespace is shared by every DSH profile under the same `DSH_HOME`. An
  override written from one profile's card therefore applies to the others as well.
- **Send test email** reaches the host through an exact Fetch route registered under `/api`, because
  `0.1.5-rc.2` admits only one interceptor per shared channel and `/api` is already claimed by the
  Typert gateway, while the documented `rpc.handle('/<channel>', …)` route for a plugin-owned channel
  fails in this release with `cannot get property "webServer" without inject`. The route still sits
  behind `/api`'s Host/Origin trust fence and browser-session authentication, but it does not get the
  Connection envelope codec, so the envelope is reproduced in `src/web-rpc.ts` against the published
  `ClientRequest` / `ServerResponse` contract. This is a workaround for `0.1.5-rc.2`, not a design
  choice, and it is the part of this release most likely to be simplified.
- The implementation may need reevaluation once DSH exposes a better plugin RPC surface. Both the
  endpoint route and the browser-side envelope encoding exist only because the documented surface was
  unavailable in this release.
