# MiMo-V2.6-Flash v0.3.1 Evaluation

Model:
mimo-v2.6-flash

Base:
v0.3.0

Base commit:
b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4

Branch:
eval/mimo-v2.6-flash-v0.3.1-ui

DSH:
0.1.5-rc.2

Initial baseline:
- check:text: PASS (119 text files strict UTF-8, BOM-free, no mojibake)
- typecheck: PASS (tsconfig.json, tsconfig.client.json, tsconfig.test.json)
- tests: PASS (451 pass, 0 fail)
- build: PASS (tsc host, tsc client, tsdown bundle lib/client.js 46.10 kB)

Environment:
- node: v24.13.0
- npm: 11.12.0
- pnpm: 11.7.0
- dsh: 0.1.5-rc.2

## Development log

### Phase 1 — collapsible card (commit f2d8a91)

API evidence used (installed rc.2 tree, not memory):
- Disclosure pattern: `dsh-client-ui-settings-plugins/lib/client.js` PluginCard —
  `<button type="button" aria-expanded>` header, `useState(false)` (collapsed by
  default), conditionally revealed body, card-local presentation state, staged
  edits outlive collapsing.
- Locale boundary: `@deepseek-ai/dsh-client-locale` (present in the global
  rc.2 tree) exposes `ctx.locale.register(ns, { zh, en })` / `bind(ns)` /
  `subscribe`, augments `Context.locale`, and is installed as the renderer's
  locale face (`slots.installLocale`). Slot registrations declaring `locale:`
  receive a typed `t` prop seat (`PropsLocale<N>`, `LocaleNamespaceMap`
  declaration merging in `@deepseek-ai/dsh-client-ui-slots`), and the renderer
  re-renders every outlet on locale revision (`useLocaleRevision`).

Implementation:
- Whole-card disclosure, collapsed by default, component-local `open` state;
  semantic button with `aria-expanded` + `aria-controls`; platform Enter/Space
  activation (no bespoke key handler); `:focus-visible` ring via a once-guarded
  injected stylesheet (pseudo-class cannot be expressed inline).
- Collapsed header summary: Active/Inactive · SMTP configured/not · Questions
  on/off/inherited · Saving…/Sending… while busy. No recipients, SMTP user,
  host, queue detail, or credential material.
- Status block moved to the end of the expanded body under a "Status" heading.
- New dev-only test dependencies: jsdom, @types/jsdom, @testing-library/react,
  @testing-library/dom, @testing-library/user-event. Component tests exercise
  the BUILT `lib/client.js` (rebuilt when stale under a mkdir lock) through a
  mock DSH context, so the real bundle, controller, and component are under test.

Verification this phase: `check:text` PASS (126 files), `typecheck` PASS (three
programs), `npm test` 465/465 pass (451 baseline + 14 new COL tests), `build`
PASS (lib/client.js 50.88 kB). The 14 COL tests passed on their first run;
two compile iterations were needed for the harness (missing `@types/jsdom`; the
`user-event` default import resolves to the module namespace under this
program's interop, so the named `userEvent` export is used).

### Environment incident — concurrent sibling evaluations in one checkout

Between branch creation (verified `eval/mimo-v2.6-flash-v0.3.1-ui` at
`b352c91`, clean tree) and the first commit, an external process created and
switched HEAD to a branch named `gpt-6` (same base `b352c91`) in this shared
checkout; the phase-1 commit therefore landed on `gpt-6`. Recovery: the commit
was verified (parent `b352c91`, only my own file changes), then
`eval/mimo-v2.6-flash-v0.3.1-ui` was fast-forwarded to it.

A second external process (branch `eval/gpt-5.6-sol-v0.3.1-ui`, another model
evaluation running concurrently in the same working tree) then force-checked
out `v0.3.0` and cleaned the tree, deleting all uncommitted phase-2 work from
the canonical checkout (the committed phase-1 work was untouched: branch
`eval/mimo-v2.6-flash-v0.3.1-ui` still pointed at `f2d8a91`).

Recovery: the experiment moved to an isolated local clone of the same
repository (`E:\Projects\DSHarness\dsh-mail-notify-mimo`) checked out on the
evaluation branch. All subsequent work happens there; at completion the branch
is fetched back into the canonical repository by local path fetch (no remote
push). No content of any other experiment's branch was read, checked out, or
copied at any point.
