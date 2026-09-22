# Release notes — v0.3.1

## What this release fixes

Two user-experience defects on the v0.3.0 Web configuration card. This
release contains **no change to the notification engine**: the listeners, the
policy, the rendering, the queue, the credential path, the transport, and every
schema default are untouched, and the host half differs from v0.3.0 in no
source file.

**1. The settings card is now collapsible (defect A).** In
`Settings → Plugins → Plugin configuration` the dsh-mail-notify card renders
collapsed by default as one compact row — title, a one-line operational
summary, and a chevron — so the rest of the Settings page is reachable without
scrolling past the form. The header is a semantic `<button>` carrying
`aria-expanded` and `aria-controls`; Enter and Space activation come from the
platform, the focus ring is visible, and activating inner form controls never
toggles the disclosure. Disclosure state is component-local presentation
state: it is never written to settings, credentials, or any store. Collapsing
does not touch the controller, so staged drafts, an in-flight save, an
in-flight test email, and the password draft all survive a collapse and
re-expand exactly as they survive a tab switch. The collapsed summary shows
only safe facts — Active/Inactive, SMTP configured or not, the effective
question switch, and a compact Saving…/Sending… while an operation crosses the
wire — never recipients, the SMTP user, queue detail, or credential material.

**2. The Web configuration UI is fully localized (defect B).** Every
user-visible string now comes from one typed bilingual vocabulary
(`src/client/locales.ts`) registered with the DSH `0.1.5-rc.2` locale service
under this plugin's namespace. The card's slot registration declares
`locale:`, so the renderer's `t` seat resolves copy against the active DSH
locale at render time; switching DSH between English and Simplified Chinese
switches the card with it while mounted, and unknown locales fall back to
English through the locale chain's terminus. Key parity between `en` and `zh`
is enforced at compile time (a missing or extra key is a type error) and
again by tests. Technical terms — DSH, SMTP, TLS, STARTTLS — stay canonical in
both languages; host-authored diagnostics (a settings rejection, an endpoint's
redacted failure) are carried through verbatim rather than paraphrased.

## Compatibility

- Verified target: **`@deepseek-ai/dsh@0.1.5-rc.2`**, unchanged from v0.3.0.
- The manifest gains one boot-graph edge — `@deepseek-ai/dsh-client-locale`,
  which ships inside every rc.2 DSH installation and activates `immediately` —
  and the client `inject` list gains the matching `locale` service gate.
- The runtime require set is unchanged: the bundle still requires exactly
  `react` and `react/jsx-runtime` from the shell's seed table. No new external
  require, no second React, no rc.7 package anywhere in the artefact.
- Existing patch-file configuration, settings precedence, Reset semantics,
  write-only credentials, the delivery test's production path, and live
  runtime apply all behave exactly as v0.3.0 documented.

## End-to-end probe harness

The committed e2e overlay previously addressed its inserted loader rows with
`!!js` name expressions. The pinned rc.2 loader (`cordis-plugin-loader` 1.0.3,
the newest published) interpolates expressions for `disabled` and for config
values but never for an entry `name`, so on the current installation the
overlay reached `import()` as an unevaluated node and the boot died with
`name.startsWith is not a function`. The probe now materializes those rows
into a per-run generated overlay with plain absolute string names (anchored to
file URLs by the overlay parser) and carries the plugin settings in that
overlay as data. Machine paths still never enter the repository. This changes
probe tooling only; no plugin runtime code is affected.

## Verification performed

- `npm run check:text`, `npm run typecheck` (three programs), `npm test`
  (**479/479**: 451 carried over from v0.3.0, 14 new collapse tests
  COL-01…COL-14, 13 new localization tests L10N-01…L10N-11 plus vocabulary
  checks, 1 packed-bundle dictionary check), `npm run build`.
- `npm pack` → `dsh-mail-notify-0.3.1.tgz` (108 entries, 633.7 kB unpacked),
  `npm run pack:check` PASS, `npm run scan:secrets` PASS (0 credential hits).
  Tarball inspection: `./client` export resolves, the bundle carries both
  dictionaries and the disclosure, requires exactly the two React seed
  modules, and contains no rc.7 reference, no absolute local path, and no
  secret.
- Install of the packed tgz into a disposable DSH `0.1.5-rc.2` profile under
  a disposable `DSH_HOME` (`dsh plugin --profile mimo031 add …`), then the
  real Web UI in Chromium:
  - English: card starts collapsed as a 73 px row with
    `aria-expanded=false`; the other plugin cards sit immediately below;
    expanding shows the full English form; staged edits (including the
    password draft) survive collapse/re-expand; Save writes the user layer to
    `settings.yaml` (no password present), the runtime mounts live
    (`plugin active`), and **Send test email** delivers through the loopback
    SMTP sink with the localized confirmation line.
  - Keyboard: Enter collapses, Space expands, focus stays on the header.
  - Chinese: switching DSH to 简体中文 re-renders the card as
    邮件通知 / 配置邮件通知 / 需要用户回答 / 需要用户批准 / 发送测试邮件 /
    恢复继承值 / 保存, with 常规、通知类型、邮件内容、发送与重试、状态 group
    headings, no English fragments, no horizontal overflow at collapsed
    (73 px) or expanded height; a real save reports 已保存。
- `npm run probe:questions` against the built 0.3.1 host: child exit 0,
  exactly 2 messages — `[DSH] Input required — Choose Mode` (a real
  `ask_user_question`, `notifyQuestions: true`) and
  `[DSH] Task completed — probe-scripted` — with the credential contract
  0 FAIL / 14 PASS on the shipped rc.2 file-backed store.

## Known limitations

- Host-authored diagnostics (settings rejections, redacted endpoint
  failures) remain in the producer's language inside a localized frame; only
  this plugin's own copy is translated.
- The card's status line polls every five seconds while mounted, collapsed
  included; the host pushes none of those facts (unchanged from v0.3.0).
- `smtpPasswordCredential` remains schema-required with no default: a
  deployment that has never set the credential reference keeps the runtime
  unmounted with the reason shown in the Status block (unchanged from v0.3.0).
- The nested optional section disclosures from the v0.3.1 brief were not
  implemented: whole-card collapse removes the reported density problem, and
  an additional accordion state would add interaction cost without a measured
  benefit.
