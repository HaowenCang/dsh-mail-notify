# V0.5.1 Web-runtime verification — DSH 0.2.1-rc.2

Scope: the **Web half** of the `dsh-mail-notify@0.5.1` compatibility gate, on a fully isolated
real `@deepseek-ai/dsh@0.2.1-rc.2` host. Candidate tarball, real plugin manager, real Host,
real Chrome over the DevTools Protocol, loopback SMTP only, no real model traffic.

Verifier: `web-verifier` (C4-B). Date: 2026-10-17. Branch `compat/dsh-0.2.1-rc.2`.
Repo file written by this task: this report and one minimal harness adaptation
(`scripts/probe/browser-e2e.mjs`, diff summary in §6.3). Nothing was committed; `main` untouched.

**Verdict: PASS.** Every task item below passed on the FINAL artifact bytes. Two claims are
explicitly bounded rather than asserted: the HMR client-bundle reload is not separately
observable (the behavior after a CLI re-add / remount / restart is), and the failed first
attempt's eight onboarding RPC envelopes cannot be re-read retroactively (the mechanism is
identified and the check was hardened; see §6.4).

---

## 1. Artifact identity

| Artifact | Size | Files | SHA-256 | Use |
| --- | --- | --- | --- | --- |
| `dsh-mail-notify-0.5.1.tgz` **FINAL** | 204 061 B | 113 | `BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF` | **official evidence** |
| `…-0.5.1.tgz` preliminary | 203 187 B | 113 | `50FE12B384A0541487F5C237A91D1FEA898DD84D2B9456B219E6D778CA383000` | P preliminary run (preserved by Lead at `tmp/phase051/artifact-verified-50FE12B3.tgz`) |
| `…-0.5.1.tgz` superseded | 203 192 B | 113 | `D6383C8359C19803E8473F348379BE217F7D57E7F779AB8DCAC8C1BA034110BF` | discarded before any accepted evidence |

- FINAL hash verified **before and after** every scripted step (`runs/00-env/host-version.json`,
  `runs/01-install/install-acceptance.json`, `runs/06-invalid-save-status/summary.json`,
  `runs/11-uninstall-readd/summary.json`).
- Own tarball-content check of the FINAL bytes: 113 files; `package/package.json` SHA-256 identical
  to the repo `package.json`; every `lib/**` file byte-identical to the repo `lib/**`.
- Behavioral equivalence to the preliminary bytes is as recorded by the Lead in
  `tmp/phase051/artifact-compare.json` (113 vs 113 entries, 107 byte-identical, 5 comment-only
  code files, README.md the only documented content change); the FINAL bytes were nevertheless
  re-installed and the browser suite re-run, and it is the FINAL run that is cited.
- The superseded artifact was discarded the moment the Lead reported the new hash: its Web Host
  was stopped, the resolved absolute path `E:\Projects\DSHarness\_phase051-compat\verify-web\dshhome\main`
  was printed and deleted (as logged), the profile was recreated from the shipped `web` template,
  and its evidence was moved to `runs/superseded-D6383C83/`.

Verbatim identity line (`runs/00-env/host-version.json`):

```text
dshVersionStdout   : 0.2.1-rc.2
hostPackageVersion : 0.2.1-rc.2
artifactSha256     : BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF
artifactSize       : 204061
```

## 2. Host version proof and isolation

The 0.2.1 host is an npm install at `E:\Projects\DSHarness\_phase051-compat\host`
(`@deepseek-ai/dsh@0.2.1-rc.2`, `--save-exact`). Every dsh invocation in this task used:

```powershell
$env:DSH_INSTALL_ROOT = 'E:\Projects\DSHarness\_phase051-compat\host'
$env:Path             = 'E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin;' + $env:Path
$env:DSH_HOME         = 'E:\Projects\DSHarness\_phase051-compat\verify-web\dshhome\main'   # verifier-owned
```

Proof, in the same environment used for all evidence:

```text
PATH first entry     : E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin
dsh resolved          : ...\host\node_modules\.bin\dsh.ps1
`dsh --version`       : 0.2.1-rc.2   (stdout, exit 0)
@deepseek-ai/dsh pkg  : {"name":"@deepseek-ai/dsh","version":"0.2.1-rc.2"}
global 0.2.0-rc.2 shim present on PATH but never resolved (the isolated .bin is first)
node / npm / Chrome   : v24.13.0 / 11.12.0 / 155.0.8059.84
```

Evidence: `runs/00-env/` (`host-version.json`, transcript, `dsh-version.{stdout,stderr,combined}.log`).

**Isolation (task item 9).** All runner scripts dot-source `verify-web/env.ps1`, which refuses to
continue unless the verify root resolves to its exact absolute path, overrides any inherited
`DSH_HOME`, and re-checks that the resolved `DSH_HOME` stays under the verify root and is not
`C:\Users\20659\.dsh`. Every transcript records the inherited real path being overridden:

```text
[env] inherited DSH_HOME 'C:\Users\20659\.dsh' is OUTSIDE the verify root -- overriding it, never using it
[env] verify root  : E:\Projects\DSHarness\_phase051-compat\verify-web
[env] DSH_HOME     : E:\Projects\DSHarness\_phase051-compat\verify-web\dshhome\main
[env] real home    : NOT USED (C:\Users\20659\.dsh untouched)
```

| Isolation fact | Value |
| --- | --- |
| Isolated `DSH_HOME` | `E:\Projects\DSHarness\_phase051-compat\verify-web\dshhome\main` |
| Web port (dedicated, non-operator) | `127.0.0.1:51331` (operator live DSH is on 1911/19387 — not used) |
| Loopback SMTP sink | `127.0.0.1:25101` only |
| CDP ports | 9231 (harness), 9243/9245/9246 (probes) |
| Chrome profiles | `verify-web\chrome\profiles\*` (dedicated `--user-data-dir`, never the operator profile) |
| Profiles | `mail-notify-051-web` (non-shipped name, created from the shipped `web` template) |
| Host/install writes | none: the shared `host\` was used read-only; no writes to `runtime\`, `evidence\` |
| Real profile read/written | never: no command was given the real home; every child env forced the isolated one |
| Real credentials / model spend | none: loopback SMTP only; model tokens from a scripted provider (§9–§10) |

## 3. Native acceptance — FINAL bytes, no exemption (task item 1)

Fresh profile `mail-notify-051-web` created from the shipped `web` template, then:

```text
dsh plugin --profile mail-notify-051-web add E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz
```

Verbatim (new-artifact run, `runs/01-install/02-plugin-add.combined.log`):

```text
dependencies:
+ dsh-mail-notify file:E:/Projects/DSHarness/dsh-mail-notify/dsh-mail-notify-0.5.1.tgz

Packages: +2
++
Progress: resolved 2, reused 2, downloaded 0, added 2, done
Done in 601ms using pnpm v11.7.0
=== exit code: 0 ===
```

stderr empty. No `allow-version`, `--accept-risk`, exemption, peer bypass or version override was
ever issued by any script in this task.

| Check | Result | Evidence |
| --- | --- | --- |
| exit code 0 | PASS | `runs/01-install/install-acceptance.json` |
| profile dependency gained `dsh-mail-notify` | PASS | same |
| `dsh.profile.bundles` contains `dsh-mail-notify` | PASS | `…,@deepseek-ai/dsh-web-app,dsh-mail-notify` |
| installed package version 0.5.1 | PASS | same |
| profile `compatibility.json` ABSENT (no exemption) | PASS | same + §10 after re-add |
| no allow-version/exemption artifact in profile | PASS | same |
| composed profile tree lists the plugin | PASS | `runs/01-install/03-dump-config.stdout.log` (`- id: dsh-mail-notify`) |
| artifact hash identical before/after | PASS | `…BFB91D4F…` |

The composed row arrives from the installed package's own bundle layer
(`node_modules/dsh-mail-notify/cordis.patch.yml`: `insert: [{id: dsh-mail-notify, config: {enabled: false}}]`);
the profile's own patch layer correctly starts as the untouched empty array, and a Web-UI Save
later writes the user configuration into it (§6.2). `pnpm` emits its usual peer-dependency warning
(the same shape the published 0.5.0 produced); the Host's own gate evaluated the manifest and
accepted — that is what exit 0 + empty stderr + no exemption record proves.

## 4. Real `dsh web` boot (task item 2)

```text
dsh --profile mail-notify-051-web --no-open --host 127.0.0.1 --port 51331
```

with the env above. Readiness: the launcher prints `dsh web: http://127.0.0.1:51331/?token=…`;
that exact URL (bare root is 401 by design) answers **HTTP 200**, `<title>DeepSeek Harness`,
37 857 bytes, `window.__DSH_BOOT__` present. The URL token is disposable and redacted in the
report; the raw URL is in `runs/02-boot/web-boot.json`.

```text
[boot] exec: dsh --profile mail-notify-051-web --no-open --host 127.0.0.1 --port 51331
[boot] node child pid=…   [boot] HTTP status=200 title='DeepSeek Harness'
[boot] URL (redacted): http://127.0.0.1:51331/?token=<redacted>
```

Runners: `scripts/30-boot-web.ps1` (stock) and `scripts/32-boot-web-events.ps1` (with the
scripted-provider overlay, §9), `scripts/31-stop-web.ps1` (stop by recorded pid with a
pid/command-line re-proof). The instance was booted from scratch **three** times on the final
bytes (stock, scripted-provider, scripted-provider again after a full plugin-manager
uninstall/re-add), each time with HTTP 200.

## 5. Onboarding — exactly the steps used

The 0.2.1-rc.2 first-boot UI has two layers that 0.2.0 did not (verified against
`docs/compat/03_HOST_INSTALL_GATE.md` §5.3 and reproduced here):

1. **Preview Notice modal** → find the `Continue` button, click it, then **poll** until
   `document.body.innerText` no longer contains `Preview Notice` (bounded 30 s). The
   acknowledgement persists Host-side (it lands in `ui-settings-general` as
   `welcomeNoticeVersion: 2026-09-28.1`), which is why the same profile does not show it again.
2. **"Get started" sign-in dialog** over the Plugins page (no account is required for this work)
   → close it via its `aria-label="Close"` control. 0.2.0's `Configure later` no longer exists;
   it is kept only as a harmless fallback in the harness.
3. **Plugins page** → installed row `dsh-mail-notify` → the configuration card. The row may open
   the card already expanded; the harness therefore reads the card state and clicks the title
   only when it is collapsed, then polls for the labelled controls.

Every run records these decisions in its transcript; the failed first attempt and its diagnosis
are recorded in §6.4/§11.

## 6. Browser end-to-end — 26 / 26 on FINAL bytes (task item 3)

Repository harness `scripts/probe/browser-e2e.mjs`, real Chrome 155 over CDP, against the isolated
instance, `PROBE_EXPECT_VERSION=0.5.1`, disposable Chrome profile, loopback sink on 25101.
Evidence: `runs/05-browser-e2e-final/` (`browser-e2e-stdout.log`, `browser-e2e-summary.json`,
`rpc-envelopes.json`, `run-transcript.log`).

```text
[browser] PASS the shell booted
[browser] PASS the Plugins page opened
[browser] PASS the installed plugin row was found
[browser] PASS the page does not report a plugin load failure
[browser] PASS the plugin is listed as installed
[browser] PASS the listed version is the candidate version      (v0.5.1)
[browser] PASS the configuration card was expanded — alreadyExpanded=false clicked=true
[browser] PASS exactly one configuration card exists — count=1
[browser] PASS all 23 expected Config controls have labelled browser controls, and the 1 expected
          write-only password Credential control is present — config 23/23, credential 1/1
[browser] PASS the SMTP host field accepted a value
[browser] PASS the port field accepted a value
[browser] PASS the username field accepted a value
[browser] PASS the from field accepted a value
[browser] PASS the recipients field accepted a value
[browser] PASS the enable switch was turned on
[browser] PASS the password field accepted a value
[browser] PASS the form registered every edit before Save — {"smtpHost":"127.0.0.1","smtpPort":"25101","smtpUser":"probe-user","from":"probe@browser.local","enabled":"true","saveDisabled":false}
[browser] PASS the Save control is enabled once the form is dirty — disabled=false
[browser] PASS the Save button exists
[browser] PASS the Host accepted the commit — save-scoped envelopes=1 (all mutate requests=2)
[browser] PASS no commit was refused by the Host
[browser] PASS the card does not report a refused save
[browser] PASS the card reports the plugin as configured — Active · SMTP configured · Questions off
[browser] PASS the Send test email control exists
[browser] PASS the loopback sink received the test email — messages=1
[browser] PASS the page produced no uncaught error or console error
[browser] 26/26 assertions passed
```

Additional facts recorded by the run:

- the 23 Config labels were matched **individually** (not a count), and the 1 write-only password
  Credential control is a separate class; the assertion detail is `config 23/23, credential 1/1`.
- the **Save was judged only by the RPC envelope**: `rpc-envelopes.json` shows the save-scoped
  `settings/mutate` request with `"httpStatus": 200` and
  `"envelope": {"type":"server-response", … "result":{"ok":true,…}}`; the second mutate request in
  that run was the Host's own `ui-settings-general` welcome-notice acknowledgement, which the
  harness now excludes from commit judgement.
- the commit persisted to the profile (verbatim `cordis.patch.yml` after the run):

```yaml
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config:
    welcomeNoticeVersion: 2026-09-28.1
- id: dsh-mail-notify
  name: dsh-mail-notify
  config:
    enabled: true
    smtpHost: 127.0.0.1
    smtpPort: 25101
    smtpUser: probe-user
    from: probe@browser.local
    to:
      - operator@browser.local
```

- loopback sink receipt, exactly one for one *Send test email*:
  `{"at":1792288422815,"bytes":592,"subject":"[DSH] dsh-mail-notify test message"}`
- artifact SHA-256 unchanged before/after: `…BFB91D4F…`.

### 6.1 Field evidence, restated precisely

The 23 expected Config display labels are the card's own handwritten copy:
`Questions requiring input`, `Approval requests`, `Enable mail notifications`, `Include subagent
activity`, `Completed turns`, `Errors`, `Token-limit termination`, `Minimum turn duration`,
`SMTP host`, `Port`, `Security`, `Username`, `From`, `Recipients`, `Credential reference`,
`Include metadata`, `Include user prompt`, `Include footer`, `Maximum body length`, `Queue size`,
`Retry attempts`, `Retry base delay`, `Dedupe cache size`; plus the separate write-only password
Credential control (`Set password`). This is rendering evidence, not a Host/Web key-set
comparison — that complementary invariant is the unit suite's PAR-01 (unchanged by this task).
No count-only fallback exists.

### 6.2 The 0.2.1 Save path (what the envelope proves)

`settings/mutate` request shape observed on the wire (from a later probe, same UI Save path):

```json
{"type":"client-request","rpcId":"…","method":"settings/mutate",
 "payload":{"args":{"ns":"dsh-mail-notify","ops":[{"op":"set","path":["smtpUser"],"value":"probe-user"}],"expectedRevision":1}}}
```

and the refusal path (§7) shows the same envelope carrying `result.ok:false` over HTTP 200.

### 6.3 Harness adaptation summary (only `scripts/probe/browser-e2e.mjs`)

The 0.2.1 Web UI changed **flow**, not the asserted surface. The repository harness was adapted
minimally — every assertion, its strength, and the 26 count are unchanged. Stored diff:
`verify-web/evidence/browser-e2e-harness.diff` (127 insertions, 14 deletions in one file).

1. **Preview Notice**: one fixed click + 2.5 s sleep → click `Continue` and poll until the notice
   leaves the DOM (runbook recipe; acknowledgement is Host-side). No assertion added.
2. **Plugins readiness**: wait for the route shell (`Installed plugins` / `Get started` /
   `Built-in plugin settings`) before acting, instead of assuming 3.5 s.
3. **Account panel**: dismiss the 0.2.1 "Get started" dialog via its `aria-label="Close"`
   control; 0.2.0's `Configure later` remains only as a fallback. This is new flow, not a weakened
   assertion.
4. **Installed row**: poll for the `dsh-mail-notify` row (up to 15 s) instead of a fixed sleep.
5. **Card expansion**: read `section[data-plugin-config]` + label state first; click the card title
   only when it is collapsed (clicking an already-expanded card collapses it); then poll up to
   20 s for the card's labelled controls to render. The assertion still requires exactly one
   section, 23 named Config labels and 1 named Credential label.
6. **Commit judgement is save-scoped**: request ids are snapshotted at the Save click and only
   envelopes belonging to requests issued after it are considered accepted/refused; each
   mutate's HTTP status is recorded. This *strengthens* the check: on 0.2.1 the first boot itself
   commits settings (welcome notice), and the old "some mutate envelope said ok" could be
   satisfied by onboarding traffic. (No assertion count change.)
7. **Evidence dump**: the harness writes `rpc-envelopes.json` (all mutate + plugin envelopes with
   HTTP statuses and the save-scoping flag) next to its output for audit. Assertions never read it.

### 6.4 The failed first attempt (recorded, not hidden)

The first final-bytes harness attempt returned **12/26**: the card section existed but had zero
`label` elements at sample time, so every field/Save/Test-Email assertion failed while the shell,
plugin row, and card-count checks passed. This was diagnosed, not assumed:

- A diagnostic replay of the **original** sequence on a pristine profile
  (`runs/07-failure-trace/`, screenshot `failure-state.png`, DOM in `failure-trace.json`) reached
  the same points and then rendered **24 labels within 500 ms**, i.e. the flow and the card are
  fine and the sample was taken while the detail view's config form had not yet mounted
  (asynchronous readiness). A dedicated timing probe (`runs/06-card-wait/`) measured
  `sections=1, labels=24` on the first sample after the click. The default-expanded/collapse
  hypothesis was not observed (`alreadyExpanded=false clicked=true`).
- The 8 `settings/mutate` envelopes counted by that failed attempt cannot be re-read: that
  harness version did not persist response bodies. On a pristine replay of the same onboarding
  flow exactly **one** mutate occurred — `ns=ui-settings-general`,
  `ops=[{"op":"set","path":["welcome…"]}]`, HTTP 200, envelope `{"result":{"ok":true,…}}` — the
  Preview Notice acknowledgement, not a plugin-config commit. That matches the failed attempt's
  other evidence (no field controls existed, no Save control was found). The save-scoped
  attribution in §6.3(6) closes that hole.
- After the adaptation the suite passed **26/26** on a pristine profile, and the persisted
  configuration above is that run's own Save.

## 7. Invalid-Save rejection — envelope, not HTTP status (task item 4)

Driven through the real expanded card on the isolated instance after the passing run: the
product-illegal-but-field-legal edit is **username cleared** while `enabled: true`; the Save was
clicked in the real form. Evidence: `runs/06-invalid-save-status/`
(`invalid-save-status-report.json`, screenshots, transcript).

| Fact | Observed |
| --- | --- |
| Save control | found, enabled |
| request | `{"type":"client-request","rpcId":"82e1c928…","method":"settings/mutate","payload":{"args":{"ns":"dsh-mail-notify","ops":[{"op":"unset","path":["smtpUser"]}],"expectedRevision":1}}}` |
| **HTTP status** | **200** ← the trap; the write path answers 200 on refusal |
| **RPC envelope** | `{"type":"server-response","rpcId":"82e1c928…","result":{"ok":false,"error":{"code":"settings/rejected","message":"invalid config:\n  - smtpUser is required and must be a non-empty user name (at smtpUser)","details":{"ns":"dsh-mail-notify"}}}}` |
| judgement used | envelope `result.ok === false` + the Host's own message (not the HTTP status) |
| profile `cordis.patch.yml` | **byte-identical** across the refused save: SHA-256 `f218a0b0…96ada57` before and after; 555 chars before/after, no plugin row change |
| recovery | restoring `probe-user` and Saving again produced envelope `ok:true` (HTTP 200) |

## 8. Status RPC and exactly one Test Email (task item 6)

Same probe, after recovery. `POST /api/dsh-mail-notify/status` with the real Connection request
envelope `{type:"client-request", rpcId, method:"dsh-mail-notify/status", payload:{}}`:

```json
{"type":"server-response","rpcId":"…","result":{"ok":true,"value":{
  "active":true,"smtpConfigured":true,"credentialRef":"DSH_MAIL_SMTP_PASSWORD",
  "queue":{"depth":0,"size":100,"delivered":0,"failed":0}}}}
```

`POST /api/dsh-mail-notify/test-email`:

```json
{"type":"server-response","rpcId":"…","result":{"ok":true,"value":{"delivered":true,"recipientCount":1}}}
```

The loopback sink received **exactly one** message for that one Test Email
(`messages=1`, `subject:"[DSH] dsh-mail-notify test message"`, fresh receipt file). The same
envelopes also appear in the browser suite's `rpc-envelopes.json` (status before/after the Save:
`active:false,smtpConfigured:false,credentialRef:""` → `active:true,smtpConfigured:true`, plus the
test-email envelope and the post-save status). `credentialRef` is a *name*, never a value.

## 9. Live volatile update with the page open (task item 5)

Instance booted with the repository's scripted LLM provider as the default model route, so the
real Web UI can drive real Turns with **no network model traffic** (the only substitution; Host,
Web runtime, plugin, session log, queue and SMTP peer are real). Runner:
`scripts/32-boot-web-events.ps1` + overlay `runs/08-boot-events/web-scripted-overlay.yml`.
Evidence: `runs/10-live-lifecycle/` (`live-lifecycle-report.json`, transcript, screenshots).

With the expanded card open, a config change was committed **through the Host** — the same path a
Save uses: `settings/mutate` → `dsh-config-editor` → Loader reconcile → volatile update — from the
page context, and the already-rendered card was required to reflect it without a reload:

| Observation | Observed |
| --- | --- |
| `enabled=false` commit envelope | `ok:true`, HTTP 200 |
| open card reflected it | `Inactive` rendered; **navigation entries 1→1**, **`performance.timeOrigin` unchanged** (no reload) |
| status RPC after | `active:false`, no queue block (runtime unmounted) |
| `enabled=true` commit envelope | `ok:true`, HTTP 200 |
| open card reflected it | `Active`; navigation 1, same `timeOrigin` |
| status RPC after re-enable | `active:true`, `smtpConfigured:true`, `queue:{depth:0,size:100,delivered:0,failed:0}` |

The card's state was also verified through the Host's `settings/describe`: the namespace revision
was read and sent back as `expectedRevision` on each write (no unconditional write).

## 10. Event-driven duplicate-send proof, uninstall/re-add, HMR/restart (tasks 7–8)

**How a notification was produced without spending a real plan.** The isolated Web profile was
booted with `scripts/probe/scripted-provider.mjs` (a real `ctx.llm.registerAdapter` plugin from
this repository) as the default model (`provider: probe`, `model: probe-scripted`,
`PROBE_SCRIPT` = its answer table). A prompt typed into the real Web UI composer
(`[contenteditable][role=textbox]` → `aria-label="Send message"`) runs a real Turn; the plugin's
real session-event listener then sends a real completion mail to the loopback sink. This is
stronger than the v0.5.0 browser run, which could not drive any notification.

### 10.1 One event = exactly one mail, across lifecycle changes (`runs/10-live-lifecycle/`)

`live-lifecycle-report.json`: 19/19 assertions. Turn mail deltas, in order:

| # | Event | Lifecycle context | Mails produced |
| --- | --- | --- | --- |
| 1 | Web-UI Turn | baseline, runtime mounted | **1** |
| 2 | Web-UI Turn | after a volatile enable→disable→enable remount | **1** |
| 3 | Web-UI Turn | card switch OFF (Save envelope `ok:true`, card `Inactive`) | **0** |
| 4 | Web-UI Turn | card switch ON again (Save envelope `ok:true`, card `Active`) | **1** |
| 5 | Web-UI Turn | after `dsh plugin add` re-add while the Host was running | **1** |

Final status RPC: `active:true, smtpConfigured:true, queue {depth:0, delivered:2}` — behaviorally
there is no stale/duplicate listener (a second listener would double every event) and no leaked
queue (depth 0 after every event; `delivered` resets on unmount, as expected of a fresh runtime).
This is behavioral evidence; the plugin exposes no listener-count field, so "no duplicate
listener" is proven by "one mail per event after every remount", not by introspection.

### 10.2 Real plugin-manager uninstall → re-add → restart (`runs/11-uninstall-readd/`)

24/24 assertions; verbatim key results:

```text
dsh plugin --profile mail-notify-051-web remove dsh-mail-notify        → exit 0
  profile package.json: dependency gone; bundles = @deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app
  node_modules/dsh-mail-notify gone; compatibility.json ABSENT; --dump-config: 0 matching lines
  user config in cordis.patch.yml untouched, SHA-256 f218a0b0…96ada57
dsh plugin --profile mail-notify-051-web add <FINAL tgz>               → exit 0, stderr empty
  installed version 0.5.1; bundle list contains dsh-mail-notify; compatibility.json ABSENT
  --dump-config lists the plugin again; patch layer still f218a0b0…96ada57 (byte-identical)
real Host restart (same boot command as §4)                             → HTTP 200
one Web-UI Turn after restart                                          → exactly 1 mail
status RPC: active:true, smtpConfigured:true, queue {depth:0, delivered:1}, no configError
artifact SHA-256 after the whole sequence                              → BFB91D4F… (unchanged)
```

The re-add path also shows the plugin manager performed no exemption write: `compatibility.json`
is absent before, between, and after the operations.

### 10.3 HMR / hot-reload finding (task item 8) — what is and is not verified

- **Verified:** `dsh plugin --profile <p> add <FINAL tgz>` while the Host was **running** is
  accepted (exit 0; `Already up to date`, pnpm relink) — the 0.2.1 plugin-manager path does not
  refuse a live re-add. After it, a Web-UI Turn produced **exactly 1** mail (delta 1), the card
  stayed `Active`, and the status RPC showed a drained queue — i.e. the post-re-add runtime is
  single-listener in behavior.
- **Verified:** the enable/disable **remount** path (settings commit → Loader reconcile → runtime
  release/mount) plus a real Host **restart** both leave exactly one mail per event (§10.1, §10.2).
- **Not separately verified:** whether `@deepseek-ai/dsh-hmr` also reloaded the *client* bundle or
  merely reconciled the composed tree. The page's navigation state after the live re-add was
  recorded in the lifecycle report (no reload was required for the checks; the probe did not
  assert a client-module reload). The claim "hot-reload path exercised" is therefore about the
  Host-side live re-add + remount/restart behavior, not about a proven client bundle swap.

## 11. Known limitations / not verifiable here

1. **Listener count is not observable.** "No stale/duplicate listener" is proven behaviorally
   (exactly one mail per event after remount/re-add/restart), not by reading an internal count;
   the plugin's status RPC exposes `active` + queue facts only.
2. **Client-bundle HMR swap not separately observable** — see §10.3.
3. **The failed attempt's 8 mutate envelopes** were not persisted by the then-current harness and
   cannot be re-read; the mechanism is identified (onboarding `ui-settings-general` acknowledgement)
   and the harness now scopes commit judgement to post-Save requests (§6.4).
4. The scripted-provider substitution is the same class of substitution the project already uses
   for headless probes (only the model's tokens are scripted). It is not a real DeepSeek plan call,
   by design: no real model traffic was permitted.
5. `pnpm` prints a peer-dependency warning on every install; the Host's gate still accepted with no
   exemption. This report does not reinterpret that warning — it is recorded as emitted.

## 12. Evidence index

All paths are under `E:\Projects\DSHarness\_phase051-compat\verify-web\` except the repo harness.

| Path | Contents |
| --- | --- |
| `runs/00-env/` | host-version proof (`dsh --version` = 0.2.1-rc.2), env identity, artifact hash |
| `runs/01-install/` | FINAL-artifact native acceptance verbatim, profile state, `install-acceptance.json` |
| `runs/02-boot/` | stock web boot state (`web-boot.json`: URL, pids, HTTP 200, title) and logs |
| `runs/05-browser-e2e-final/` | **official 26/26** log, summary JSON, `rpc-envelopes.json`, transcript |
| `runs/05-browser-e2e-final-attempt1-FLAKY/` | the recorded 12/26 first attempt (diagnosed in §6.4) |
| `runs/06-card-wait/`, `runs/07-failure-trace/` | card-readiness measurements and the original-flow replay |
| `runs/06-invalid-save-status/` | refused-save envelope + HTTP 200 + byte-identical patch; status/test-email envelopes; exactly-one receipt |
| `runs/08-boot-events/` | scripted-provider overlay + boot state for the event-driven checks |
| `runs/09-turn-event/` | first Web-UI Turn producing a real completion mail |
| `runs/10-live-lifecycle/` | live update without reload; per-event mail deltas `1,1,0,1,1`; CLI re-add while running |
| `runs/11-uninstall-readd/` | uninstall/re-add/restart, config preservation, one mail after restart, 24/24 |
| `runs/preliminary-50FE12B3/` | the preliminary-hash run set (kept for provenance) |
| `runs/superseded-D6383C83/`, `runs/04-*/` | superseded-artifact evidence and diagnostics |
| `evidence/browser-e2e-harness.diff` | exact harness adaptation diff |
| `scripts/` | every runner script (`10`…`80`, `env.ps1`, probes) — reproduce with the commands in §13 |

## 13. Reproduction

Environment for every command (also encoded in `verify-web/env.ps1`):

```powershell
$root = 'E:\Projects\DSHarness\_phase051-compat\verify-web'
$env:DSH_HOME         = Join-Path $root 'dshhome\main'
$env:DSH_INSTALL_ROOT = 'E:\Projects\DSHarness\_phase051-compat\host'
$env:Path             = (Join-Path $env:DSH_INSTALL_ROOT 'node_modules\.bin') + ';' + $env:Path
```

```powershell
powershell -NoProfile -File $root\scripts\10-host-version.ps1          # host + hash proof
powershell -NoProfile -File $root\scripts\20-install-acceptance.ps1    # native acceptance
powershell -NoProfile -File $root\scripts\30-boot-web.ps1              # boot isolated web on 51331
powershell -NoProfile -File $root\scripts\40-browser-e2e.ps1           # official 26/26
powershell -NoProfile -File $root\scripts\61-invalid-save-status.ps1   # tasks 4 + 6
powershell -NoProfile -File $root\scripts\31-stop-web.ps1              # stop stock instance
powershell -NoProfile -File $root\scripts\32-boot-web-events.ps1       # boot with scripted provider
powershell -NoProfile -File $root\scripts\71-live-lifecycle.ps1        # live update + event proofs
powershell -NoProfile -File $root\scripts\80-uninstall-readd.ps1       # uninstall/re-add/restart
```

Each runner writes its own transcript, raw streams, screenshots and a machine-readable summary
under `runs\<step>\`.

## 14. Verdict

| Task | Result |
| --- | --- |
| 1. Native acceptance, fresh profile, FINAL bytes, no exemption | **PASS** |
| 2. Real `dsh web` boot, dedicated port, disposable home, URL+token | **PASS** |
| 3. Real-browser E2E: 26/26 (envelope-judged Save, 23 named labels + 1 credential, no console errors, Test Email received, commit persisted) | **PASS** |
| 4. Invalid Save: envelope `ok:false` with Host text, HTTP 200 trap recorded, patch byte-identical | **PASS** |
| 5. Live volatile update reflected in the open card with no reload; status RPC transitions | **PASS** |
| 6. Status RPC + Test Email envelopes; exactly 1 loopback SMTP message | **PASS** |
| 7. Uninstall → re-add (no exemption) → enable off/on → exactly one mail per event; config preserved | **PASS** |
| 8. Live CLI re-add while running accepted; remount + restart; one mail per event, drained queue | **PASS** (bounded as in §10.3) |
| 9. Isolation proof: isolated home/ports/Chrome, real profile untouched | **PASS** |

On the FINAL artifact `BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF`,
against isolated DSH `0.2.1-rc.2`, with no compatibility exemption of any kind: **all Web-runtime
gates pass.** The only repo change is the minimal, assertion-preserving adaptation of
`scripts/probe/browser-e2e.mjs` described in §6.3.
