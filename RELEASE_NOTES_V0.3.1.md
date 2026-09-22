# dsh-mail-notify v0.3.1

Released baseline: v0.3.0 (`b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4`)
Verified DSH target: `@deepseek-ai/dsh@0.1.5-rc.2`

v0.3.1 is a browser-surface release. It changes how the configuration card occupies the Settings
page and what language it speaks. No host-side module changed, no configuration semantics changed,
and no notification behaviour changed.

---

## 1. The card collapses

v0.3.0 rendered the whole configuration form permanently open. Fourteen fields — two switches, eight
more booleans, six text and numeric controls, plus the credential control — occupied most of a
viewport, so reaching any unrelated DSH setting below it cost a scroll.

The entire card is now one disclosure and **starts collapsed**. The collapsed header states three
facts:

```
Mail notifications                         ▸
Active · SMTP configured · Questions on
```

```
邮件通知                                   ▸
运行中 · SMTP 已配置 · 提问通知已启用
```

Expanding reveals the v0.3.0 form unchanged. A collapsed card occupies roughly one compact settings
card.

### Accessibility

The header is a native `<button type="button">` carrying `aria-expanded` and `aria-controls`
pointing at the body's `role="region"`. There is no clickable non-semantic element and no handler on
a wrapper, so a pointer, **Enter**, and **Space** all activate it through the user agent's own
default action. The button is in the tab order with no `tabindex` override, its accessible name
states the action and the subject (`Expand: Mail notifications` / `展开: 邮件通知`), and a visible
focus ring is applied through `:focus-visible`. Inner controls are siblings of the header, not
descendants, so pressing Save, Reset, Discard, Send test email, or the credential buttons never
toggles the card.

While collapsed the card exposes exactly one focusable element and no empty region: the body is
unmounted, not hidden.

### What the summary does and does not say

The three facts in the header are already public to the browser — two are what the plugin's status
endpoint reports, one is a boolean in the settings document the card edits. The header does **not**
render the recipient list, a question's text, the user prompt, the SMTP user name, the SMTP host, or
any part of the credential; those values are either absent from the projection the header renders or
not reachable from it.

The summary keeps reading the host's live facts while collapsed, so a runtime that stops is reported
without expanding the card.

### Drafts and in-flight work survive

Collapsing is **presentation only**.

| | |
| --- | --- |
| Staged edits (boolean and text fields) | survive collapse and re-expansion |
| A typed password | survives; while collapsed it is not in the document at all, because the input is unmounted |
| A save result (`Saved`) | survives |
| A delivery-test result | survives |
| An in-flight save or Send test email | is neither cancelled nor duplicated |
| Writes triggered by a toggle | none — no settings write, no credential call, no RPC |

The reason is structural rather than incidental: the drafts, the save state, the test outcome, and
the credential draft live in the card's controller, which the disclosure does not own, while the
body is rebuilt from that controller on every expansion.

The expansion state itself lives in the component's `useState`. It is not written to
`settings.yaml`, to the bundle's `cordis.patch.yml`, to credentials, or to the plugin settings
namespace — toggling the card performs no write of any kind, which is the observable form of that
prohibition.

---

## 2. English and Simplified Chinese

The card's copy now comes from one typed vocabulary with exact key parity between English and
Simplified Chinese.

```ts
// src/client/locales/vocabulary.ts
export type MailNotifyLocaleKey = 'title' | 'subtitle' | 'group.general' | …

// src/client/locales/en.ts, zh.ts
export const en: MailNotifyDictionary = { … }
export const zh: MailNotifyDictionary = { … }
```

Both dictionaries are declared as `Record<MailNotifyLocaleKey, string>`, so a key added to one
language and not the other fails to compile in both directions. Nothing in the JSX branches on
language; everything renders through the `t` seat.

### DSH locale integration

The dictionaries are registered with DSH's own locale service under the `dsh-mail-notify` namespace,
and the slot registration declares `locale: LOCALE_NAMESPACE`. That declaration is what makes the
renderer synthesize the typed `t` seat on the card's props and what makes it re-derive the seat when
the active locale changes, so:

| DSH UI language | Card |
| --- | --- |
| English | English |
| 简体中文 | 简体中文 |
| a language the plugin ships no dictionary for | English |

`navigator.language` is never consulted by this plugin; the active language is whatever `ctx.locale`
resolved. The `@deepseek-ai/dsh-client-locale` module graph edge is declared in `package.json` so the
locale plugin is loaded before this one.

A language switch re-renders the mounted card in place — **including a message already on screen**.
Controller messages are copy keys plus parameters rather than finished sentences, so a validation
refusal or a save result that was produced in English is displayed in Chinese immediately after the
switch, with no replay of the action.

### Validation and action messages

`parseField` returns a refusal as a copy key and its parameters, and the label it names is itself a
key resolved at render time. `端口 必须是整数` and `Port must be a whole number` are the same
refusal, and the same refusal changes language when the interface does. Save results, delivery-test
results, the reset notice, and the discarded-password notice are localized the same way.

Text the plugin did not author — a settings-provider refusal, a redacted SMTP diagnostic — is quoted
verbatim in **both** languages. Inventing a translation for a host diagnostic would mean printing a
guess at the user.

### Canonical terms

`DSH`, `SMTP`, `TLS`, and `STARTTLS` stay verbatim in both dictionaries: `SMTP 服务器`, `隐式 TLS`,
`安全连接`, and `STARTTLS` appear in the Chinese card as those terms, not as translations.

### Required vocabulary

Every string the release specification requires is present and exact, in both languages: the title
and subtitle, the group titles, all field labels and hints, the two human-attention controls and
their full descriptions, the controls (`Send test email`, `Reset`, `Save`, `Save`/`Saving…`,
`Sending…`, `Test email sent`, `Set password`, `Change password`), and the status words.

The two human-attention controls keep their prominence: they render first and apart, in their own
bordered block above the general fields, with their descriptions intact. Their defaults are
unchanged — both off.

---

## 3. What did not change

`src/` outside `src/client/` is byte-identical to v0.3.0, and `cordis.patch.yml` is byte-identical
too. Therefore:

- schema defaults, the composition layer, and the user-settings override all compose exactly as
  before;
- `Reset` is still `UNSET` — it removes the user-layer entry so the field re-inherits the
  composition layer, rather than writing a copy of the default back;
- the SMTP credential stays write-only: the browser performs `describe`, `set`, and `unset`, and the
  installed credentials namespace has no read path;
- `notifyQuestions` still means `true` → notification, `false` → suppression;
- `notifyApprovals` is unchanged, including its dedupe behaviour;
- the test-email action still travels the production mail path — the same credential lookup,
  transport construction, and failure classification a real notification uses;
- the live settings behaviour is unchanged: the status strip polls every five seconds and a
  configuration that cannot be applied is reported instead of silently doing nothing;
- TLS verification is unchanged, and no tool argument can reach a mail, the UI, or a log.

---

## 4. Verification

| Check | Result |
| --- | --- |
| `npm run check:text` | PASS — 120 files, strict UTF-8, BOM-free, no mojibake |
| `npm run typecheck` | PASS — host, client, and test programs |
| `npm test` | PASS — 494 tests, 0 failures (v0.3.0 baseline: 451) |
| `npm run build` | PASS |
| `npm pack` | `dsh-mail-notify-0.3.1.tgz`, 112 entries |
| `npm run pack:check` | PASS |
| `npm run scan:secrets` | PASS — 0 credential-value hits, 0 shaped-literal hits |

New coverage: `COL-01`…`COL-14` in `tests/client/collapse.test.ts` and `L10N-01`…`L10N-11` in
`tests/client/localization.test.ts`, both driving the rendered card through real DOM events over the
real controller.

The bundle still requires exactly `react` and `react/jsx-runtime` at runtime, both answered by the
shell's seed module table, so no second React copy and no new runtime dependency is introduced.

---

## 5. Upgrade

Nothing to do beyond installing the new package. The card starts collapsed on first view; expand it
to reach the form. The interface language follows DSH's own language setting.
