# Release notes — v0.3.1

## What this release adds

Two changes to the Web configuration surface, and no change whatsoever to the notification
engine. The same listeners, the same policy, the same rendering, the same credential and
transport path, and the same defaults — including the two secure ones: `notifyQuestions` and
`notifyApprovals` remain `false` in the schema.

**1. The settings card is collapsible.** The card in `Settings → Plugins → Plugin configuration`
is now one disclosure, collapsed by default. Collapsed it occupies a single compact row — the
title **Mail notifications** and one line of safe operational facts (`Active · SMTP configured ·
Questions on`) — so one plugin's configuration can no longer push the rest of Settings below a
long scroll. Expanding reveals the whole form.

The expansion is presentation state only: it lives in the component, is never persisted to
`settings.yaml`, `cordis.patch.yml`, or the credential store, and collapsing destroys nothing.
Staged edits, an unsaved password draft, an in-flight save or delivery test, and operation
results all survive a collapse/expand cycle, because they live in the controller and the
controller is never rebuilt for presentation reasons. The disclosure is one native
`<button type="button">` with `aria-expanded` and `aria-controls`; Enter and Space activate it
with the browser's own behavior, and the focus ring is left intact. The collapsed summary
carries no address, no username, no draft, and no credential fact beyond presence.

**2. Full English and Simplified Chinese localization.** The card follows the DSH interface
language (Settings → General → Language) through the DSH locale service:
`@deepseek-ai/dsh-client-locale`'s `LocaleRuntime.register('dsh-mail-notify', { en, zh })` at
the client plugin's activation, and the renderer's typed `t` seat derived from that namespace on
the card's slot entry. Every plugin-authored string — labels, hints, section titles, operation
messages, and validation refusals — comes from one typed vocabulary (`src/client/locale.ts`);
key parity and bilingual completeness are compile-time properties, and a language this plugin
ships no copy for renders English. Operation messages are stored as semantic identities and
translated at render, so a notice already on screen follows a live language switch.

`dsh.client.inject` gained `@deepseek-ai/dsh-client-locale` (the registry module must arrive
before this plugin's client half) and the client service gate gained `locale`.

## Configuration precedence (unchanged)

```
schema defaults  →  cordis.patch.yml (composition)  →  settings.yaml (user overrides)  →  what runs
```

**Reset means unset**, exactly as in v0.3.0: it removes the user-layer entry so the field
re-inherits the composition layer. The credential remains write-only — `describe`, `set`,
`unset`, and no read path — and the delivery test still travels the production credential,
transport, and failure-classification path.

## Verification performed

- `npm run check:text` (116 files), `npm run typecheck` (three compilation programs),
  `npm test` — **476 tests, 476 passed, 0 failed, 0 skipped** (451 from v0.3.0 unchanged and
  still passing, plus COL-01…COL-14 and L10N-01…L10N-11) — `npm run build`.
- `npm pack` → `dsh-mail-notify-0.3.1.tgz`, 108 entries, package size 171.4 kB, unpacked
  632.4 kB, SHA-256 `859c0caea09126277c28c17fd721cc5824d984f2b7fe31b04818b0472faa7cba`
  (the exact archive installed and smoke-tested below).
- `npm run pack:check` (PASS) and `npm run scan:secrets` (PASS: 0 credential-value hits,
  0 shaped-literal hits against the live credential store). The bundle requires exactly
  `react` and `react/jsx-runtime`; no second React, no absolute path, no stale release family.
- Clean install from `package.json` + `package-lock.json` alone (`npm ci` in an isolated
  directory): every new import is backed by a declared dependency — `jsdom` and
  `@types/jsdom` (test DOM), `@deepseek-ai/dsh-client-locale` (the locale contract), both
  dev-only. Nodemailer stays the single runtime dependency.
- Install into a disposable DSH `0.1.5-rc.2` profile from the packed archive, then a real
  browser pass against the running Web UI:
  - English: the card starts collapsed with its summary, unrelated settings rows immediately
    reachable, the full English form on expand, staged edits and a password draft surviving
    collapse/re-expansion, pointer activation, **native Enter and native Space activation**,
    and a visible focus ring.
  - Chinese: switching the DSH language without reloading re-rendered the card in Chinese —
    邮件通知, 常规, 通知类型, 需要用户回答, 需要用户批准, 发送测试邮件, 恢复继承值, 保存 all
    present, the two human-attention hints verbatim, canonical terms (DSH/SMTP/TLS/STARTTLS)
    intact, no English leftovers, and no horizontal page overflow. A notice created while the
    UI was English rendered in Chinese afterwards because the controller stores its identity.
  - Narrow viewport (420 px): no horizontal page overflow, the summary wraps, labels remain
    readable, and the recipients input and action buttons stay reachable.
  - Regression: `notifyQuestions` saved through the card; one real `ask_user_question` turn in
    that profile produced exactly one question notification (queue: 1 delivered, 0 failed) and
    the mail arrived at the configured mailbox; **Send test email** reported
    测试邮件已发送。SMTP 服务器已接受该邮件，共 1 个收件人。 through the production path; the
    password field rendered blank and masked throughout (write-only preserved).

The intended user state was restored afterwards (shared `settings.yaml` byte-identical to its
pre-test copy, disposable profile removed).

## One defect found and fixed during verification

The first packed candidate passed every automated check — key parity, completeness, tests,
secret scan — while eleven Chinese template strings each lacked one character (for example
已暂存重置 rendered as 已暂存重). A colon-normalization sweep had been run from a double-quoted
PowerShell string, so its `$1` backreference was expanded away by the shell and the replacement
consumed the character before every ASCII colon. The real-browser copy review caught it; all
eleven strings are restored and now pinned verbatim in the L10N-02 table. The final tarball
above is the corrected artifact — the one installed and smoke-tested.

## Known limitations

- The card's status facts are pulled every five seconds while it is on screen; the host pushes
  none of them. Queue counters are per runtime and restart when a saved configuration remounts
  it (unchanged from v0.3.0).
- At very narrow widths (a phone-sized settings pane) the form rows keep their 220 px label
  minimum and scroll horizontally inside the form area; the page itself never overflows and all
  controls stay reachable, matching the v0.3.0 form's behaviour.
- Enter/Space activation is the browser's native button behavior: the Node test suite pins the
  semantics (`<button type="button">`, `aria-expanded`, `aria-controls`) because jsdom does not
  emulate keyboard activation, and the activation itself was verified in a real browser.
- The plugin's settings namespace is shared by every DSH profile under the same `DSH_HOME`
  (unchanged), and the Web endpoints still ride exact Fetch routes under `/api` for the rc.2
  reasons documented in `RELEASE_NOTES_V0.3.0.md`.
