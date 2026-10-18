# 03 — Host install gate: isolated DSH `0.2.1-rc.2` environment, published-v0.5.0 rejection, candidate-v0.5.1 acceptance, Web runbook

**Task:** C4-A (host-builder). **Repo branch:** `compat/dsh-0.2.1-rc.2`.
**Verdict: PASS for the C4-A scope.** An isolated DSH `0.2.1-rc.2` host was installed and booted
without touching the operator's real profiles; the **published, unmodified `dsh-mail-notify@0.5.0`
is rejected by the real plugin manager** (exit 1, no exemption); the release candidate
`dsh-mail-notify@0.5.1` is accepted by the same real path** (exit 0, no exemption) — both the earlier
candidate (SHA-256 `50FE12B3…83000`, §4.2–4.4) and the **FINAL artifact** (SHA-256 `BFB91D4F…F6FF`,
§4.6) were accepted natively; the Web UI boots on a dedicated loopback port, real Chrome renders it,
and the loopback SMTP harness works. Nothing was published, tagged, committed, or installed into any
real profile.

Every claim below names the evidence file that produced it. Evidence lives under
`E:\Projects\DSHarness\_phase051-compat\evidence\`. The repo file changed by this task is **only this
document**.

---

## 1. Isolated environment (paths, guard, ports)

| Item | Value |
| --- | --- |
| Scratch root | `E:\Projects\DSHarness\_phase051-compat` (created by this task; new directory) |
| Host install root (`DSH_INSTALL_ROOT`) | `E:\Projects\DSHarness\_phase051-compat\host` |
| Isolated `DSH_HOME` | `E:\Projects\DSHarness\_phase051-compat\runtime\dsh-home` |
| Launcher | `E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin\dsh.cmd` |
| Evidence | `E:\Projects\DSHarness\_phase051-compat\evidence` |
| Runners | `E:\Projects\DSHarness\_phase051-compat\runner` |
| Web ports (this task) | **51951** (profile `compat-web-021`), **51952** (profile `compat-web-022`) |
| Loopback SMTP | **25101** (self-test only; torn down) |
| CDP ports (this task) | 9227 / 9228 / 9229 / 9230 / 9231 |
| Operator's real home | `C:\Users\20659\.dsh` — **never used as `DSH_HOME`; no command written against it** |

The tool shell that runs these commands inherits the operator's real `DSH_HOME`
(`C:\Users\20659\.dsh`) from the running harness. Every command in this task ran through
`runner/isolated-env.ps1`, which:

1. resolves the scratch root and refuses to continue unless it is exactly
   `E:\Projects\DSHarness\_phase051-compat`;
2. **records** an inherited `DSH_HOME` and refuses to leave it in force — the next statement exports
   the isolated value;
3. checks the isolated launcher exists;
4. re-resolves the `DSH_HOME` it exported and fails if it escaped the scratch root;
5. prints `[isolated-env] DSH_HOME …`, the install root, the launcher, and
   `real home: NOT USED (C:\Users\20659\.dsh untouched)` into every log.

Each probe log therefore states the home that was in force. `runner/dsh.ps1` is the only wrapper used
to invoke the launcher; it forwards arguments verbatim after setting the environment.

---

## 2. Host installation and exact resolved versions

### 2.1 Install commands (exact version, no range)

```powershell
# host directory with its own package.json ({"private":true,"name":"phase051-compat-host"})
cd E:\Projects\DSHarness\_phase051-compat\host
npm install --save-exact @deepseek-ai/dsh@0.2.1-rc.2
```

Result: **exit 0**, `added 613 packages, and audited 614 packages in 4m`
(`evidence\01_host_install_npm.log`). The registry's `next` dist-tag was `0.2.1-rc.2`
(`npm view @deepseek-ai/dsh dist-tags`). **No release-age/cooldown refusal occurred** and no fallback
to `0.2.0-rc.2` was made or needed.

### 2.2 Host version and commit

| Item | Value | Evidence |
| --- | --- | --- |
| Version (task target) | `0.2.1-rc.2` | task statement; `evidence\04_lock_dsh_entry.json` |
| Version (measured) | `dsh --version` → `0.2.1-rc.2` | `evidence\06_dsh_version.log` |
| Host commit (task-supplied) | `687f282e8625c6b8d11ff58211a90524be2e4317` | **supplied by the task, not independently derivable**: the npm tarball carries no `gitHead` (`npm view @deepseek-ai/dsh@0.2.1-rc.2 gitHead` is empty). Recorded as supplied. |
| Registry tarball | `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.2.tgz` | `evidence\04_lock_dsh_entry.json` |
| Tarball integrity | `sha512-tvY+yhfK…HwMNuw==` (lockfile) | same |
| Lockfile | `480 353` bytes, SHA-256 `F745104237182E3F175C2EF075B9C0BE30900687B7D2846D02FE5EC0BB3CB13D` | this document's capture |

### 2.3 Installed `@deepseek-ai/*` host packages (actual resolved versions)

Census over `package-lock.json` (`evidence\05_lock_all_deepseek_pkgs.json`, full list): **364**
`@deepseek-ai` package entries, of which **295 are at `0.2.1-rc.2`** (host application packages,
including every `dsh-*` runtime package). The remaining entries are non-host-versioned support
packages, unchanged from the registry's resolution:

| Package | Resolved version |
| --- | --- |
| `@deepseek-ai/dsh` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-app-boot` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-plugin-manager` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-web-app` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-host-webserver` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-credentials` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-session` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-settings` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-client-ui-plugin-manager` | `0.2.1-rc.2` |
| `@deepseek-ai/dsh-host-plugin-inventory` | `0.2.1-rc.2` |
| `@deepseek-ai/cordis` | `4.0.5` |
| `@deepseek-ai/cordis-plugin-loader` | `1.0.6` |
| `@deepseek-ai/cordis-plugin-group` / `-include` / `-timer` | `1.0.5` / `1.0.10` / `1.1.7` |
| `@deepseek-ai/schemastery` | `3.18.5` |
| `@deepseek-ai/cosmokit` | `1.8.6` |
| `@deepseek-ai/libreoffice-kit` family | `0.1.5` |
| `@deepseek-ai/node-addon-system` family | `0.1.2` |
| nested `zod` (under several dsh packages) | `4.4.3` |

`npm ls --depth=0` reports the two `extraneous` optional platform packages
`@emnapi/runtime@1.11.3` and `@img/sharp-wasm32@0.35.5`; they are registry artefacts of the host's
optional dependency graph, not drift in the host packages. `npm audit` on the **host install tree**
reported `8 moderate severity vulnerabilities` (host tooling dependency graph, `01_host_install_npm.log`);
that is the host install, not the plugin's dev tree.

Platform: Windows 11 x64 (`Microsoft Windows NT 10.0.26220.0`, `AMD64`), Node `v24.13.0`, npm `11.12.0`,
pnpm `11.7.0` (operator-global; the plugin manager forwards to `pnpm` from `PATH` — see §6 gotcha G7).

---

## 3. Gate rejection of the PUBLISHED v0.5.0 (unchanged artifact, real plugin manager)

### 3.1 Artifact provenance (verified against the registry, not inferred)

`npm pack dsh-mail-notify@0.5.0` was run into
`E:\Projects\DSHarness\_phase051-compat\evidence\published-v050\` (fresh registry download).

| Property | Value | Match |
| --- | --- | --- |
| File | `dsh-mail-notify-0.5.0.tgz`, 203 186 bytes | — |
| SHA-1 | `39306aadcafb7b840dc818dfdd0b6f6723baa20e` | `== registry dist.shasum` ✔ |
| SHA-512 (base64) | `myPx+XdpxFeyJHgFYQsI1hke7rHrXsgnh1YtyGoLRCneyy2k+GiEGaFR+fd7uioPl4XOJw0pGoPMC+ltw5MMVA==` | `== registry dist.integrity` ✔ |
| SHA-256 | `7c93bccf69b4a34e809ed1a046c2f7fd32ffee873b9a5287663ab660440f59a0` | — |

The repository-local `dsh-mail-notify-0.5.0.tgz` has the same SHA-1 (`39306aad…`), i.e. it is the same
artifact; the run below nevertheless used the fresh registry download. Manifest read from the tarball
(`evidence\10_published_v050_package.json`):

```json
{
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-credentials": "0.2.0-rc.2",
    "@deepseek-ai/dsh-session": "0.2.0-rc.2",
    "@deepseek-ai/schemastery": "^3.18.4",
    "react": "^18.2.0"
  }
}
```

### 3.2 The real attempt

Profile `gate-test-050` was created from the shipped `headless` template with the isolated launcher
(`dsh --profile gate-test-050 --from-default-profile headless --dump-config`, exit 0). The install then
used the operator-facing command, which the Launcher forwards to
`@deepseek-ai/dsh-plugin-manager/operations` (pnpm install into the profile, then the Host's
compatibility decision):

```powershell
$env:DSH_HOME         = 'E:\Projects\DSHarness\_phase051-compat\runtime\dsh-home'
$env:DSH_INSTALL_ROOT = 'E:\Projects\DSHarness\_phase051-compat\host'
& 'E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin\dsh.cmd' `
    plugin --profile gate-test-050 add `
    'E:\Projects\DSHarness\_phase051-compat\evidence\published-v050\dsh-mail-notify-0.5.0.tgz'
```

Runner: `runner/attempt-gate.ps1` (captures stdout and stderr separately, plus the exit code).
Raw logs: `evidence\12_gate_attempt_published_v050.{stdout,stderr,combined}.log`; the manager's own
operation log: `evidence\13_plugin_manager_diagnostics\logs\operation-gJynWY\pnpm.log`.

### 3.3 Verbatim rejection (stdout, then stderr, then exit code)

```text
Progress: resolved 0, reused 0, downloaded 1, added 0
Progress: resolved 1, reused 0, downloaded 1, added 0
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.

dependencies:
+ dsh-mail-notify file:E:/Projects/DSHarness/_phase051-compat/evidence/published-v050/dsh-mail-notify-0.5.0.tgz

Packages: +2
++
Progress: resolved 2, reused 0, downloaded 1, added 1
Progress: resolved 2, reused 0, downloaded 2, added 1
Progress: resolved 2, reused 0, downloaded 2, added 2, done
Done in 7.6s using pnpm v11.7.0
```

```text
dsh: installation rejected: Plugin dsh-mail-notify@0.5.0 is incompatible with dsh 0.2.1-rc.2: requirements {"@deepseek-ai/dsh-credentials":"0.2.0-rc.2","@deepseek-ai/dsh-session":"0.2.0-rc.2"}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for dsh-mail-notify@0.5.0 on dsh 0.2.1-rc.2 with `dsh plugin allow-version` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: not active.
Plugin dsh-mail-notify@0.5.0 is incompatible with dsh 0.2.1-rc.2: requirements {"@deepseek-ai/dsh-credentials":"0.2.0-rc.2","@deepseek-ai/dsh-session":"0.2.0-rc.2"}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for dsh-mail-notify@0.5.0 on dsh 0.2.1-rc.2 with `dsh plugin allow-version` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: not active.
dsh: restored package.json, pnpm-lock.yaml, and node_modules.
dsh: to accept the risk, run: dsh plugin --profile gate-test-050 allow-version dsh-mail-notify@0.5.0 --dsh-version 0.2.1-rc.2 --accept-risk
dsh: to accept the risk, run: dsh plugin --profile gate-test-050 allow-version dsh-mail-notify@0.5.0 --dsh-version 0.2.1-rc.2 --accept-risk
dsh: plugin command failed; diagnostics: E:\Projects\DSHarness\_phase051-compat\runtime\dsh-home\profiles\gate-test-050\.plugin-manager\logs\operation-gJynWY\pnpm.log
```

**Exit code: 1.** No `allow-version`, `--accept-risk`, compatibility-exemption file, or peer-bypass flag
was used at any point; the exemption line is the Host's own advice and is quoted, not followed.

### 3.4 Post-rejection state (restored)

`evidence\14_profile_state_after_rejection.json`:

- profile `package.json` `dependencies` is still `{}` — no `dsh-mail-notify`;
- `compatibility.json` **absent**; no version-exemption store was created;
- profile `node_modules` holds only `.pnpm`, `.modules.yaml`, `.pnpm-workspace-state-v1.json`.

**Reason:** the Host compares the plugin's declared requirement versions against the installed host
package versions. Installed host: `dsh-credentials 0.2.1-rc.2`, `dsh-session 0.2.1-rc.2`. Published
v0.5.0 declares exact `0.2.0-rc.2` for both → exact mismatch → rejection. The `engines.node` range is
satisfied by Node `v24.13.0`; the refusal is peer-version based.

> **Contract-delta note for the C1 source audit:** in `0.2.1-rc.2` the message names the failing set as
> `requirements {…}`; the earlier `0.2.0-rc.2` message said `peerDependencies {…}` (see
> `V0.5.0_COMPAT_REPORT.md` §4.1). Decision semantics are unchanged (exact mismatch → reject unless an
> explicit exact-version exemption is active).

---

## 4. Candidate acceptance — `dsh-mail-notify@0.5.1` (earlier `50FE…`, FINAL `BFB9…`)

> **Artifact history, every hash labelled:**
> **SUPERSEDED** SHA-256 `D6383C8359C19803E8473F348379BE217F7D57E7F779AB8DCAC8C1BA034110BF`, 203 192 bytes — accepted once (profile `candidate-051`, logs `25_*`), then replaced; its evidence is stale and is retained only as history.
> **EARLIER CANDIDATE** SHA-256 `50FE12B384A0541487F5C237A91D1FEA898DD84D2B9456B219E6D778CA383000`, 203 187 bytes, 113 files — accepted in §4.1–§4.5 (profile `candidate-051b`); later superseded by a documentation-only rebuild.
> **FINAL ARTIFACT** SHA-256 `BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF`, 204 061 bytes, 113 files — accepted in **§4.6** (profile `candidate-051f`). This is the artifact the release ships.
> Change from SUPERSEDED to EARLIER (per the Lead): the root `@deepseek-ai/dsh` peerDependency was
> removed and `engines.dsh = "0.2.1-rc.2"` became the sole host-range declaration (DSH `0.2.1`'s
> plugin-authoring guide designates `engines.dsh` as the mechanism; a root dsh peer would auto-install
> the whole host application as a production peer). The FINAL artifact differs from the EARLIER one
> only by a documentation-only rebuild (see §4.6); the plugin's declared metadata is identical.

### 4.1 Earlier candidate artifact verification (`50FE…`)

```text
E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz   (as it was at acceptance time)
size 203 187 bytes
SHA-256 50FE12B384A0541487F5C237A91D1FEA898DD84D2B9456B219E6D778CA383000  == supplied hash ✔
```

Manifest read from the tarball (`evidence\23_candidate_package.json`; the FINAL manifest is identical,
`evidence\34_final_candidate_package.json`):

```json
{
  "name": "dsh-mail-notify",
  "version": "0.5.1",
  "engines": { "node": "^22.19.0 || >=24.0.0", "dsh": "0.2.1-rc.2" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-credentials": "0.2.1-rc.2",
    "@deepseek-ai/dsh-session": "0.2.1-rc.2",
    "@deepseek-ai/schemastery": "^3.18.4",
    "react": "^18.2.0"
  }
}
```

No `@deepseek-ai/dsh` peer; `engines.dsh` is present. All candidate hashes and their status are recorded
in `evidence\22_candidate_artifact_hash.json`.

### 4.2 The real attempt — earlier candidate (fresh isolated profile)

Profile `candidate-051b`, created from the shipped `headless` template in the same isolated DSH_HOME
but distinct from `gate-test-050` and the web-boot profiles:

```powershell
& 'E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin\dsh.cmd' `
    plugin --profile candidate-051b add `
    '<the EARLIER 50FE… artifact>'
```

Raw logs: `evidence\25b_candidate_acceptance_final_051.{stdout,stderr,combined}.log` (the file name
predates the FINAL rebuild; these logs are the EARLIER candidate's).

### 4.3 Verbatim acceptance — earlier candidate

```text
Progress: resolved 0, reused 0, downloaded 1, added 0
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.

dependencies:
+ dsh-mail-notify file:E:/Projects/DSHarness/dsh-mail-notify/dsh-mail-notify-0.5.1.tgz

Packages: +2
++
Progress: resolved 2, reused 1, downloaded 1, added 2, done
Done in 760ms using pnpm v11.7.0
```

**stderr: empty. Exit code: 0.**

### 4.4 Post-install state — earlier candidate

`evidence\26b_candidate_final_installed_state.json`:

- profile `package.json` dependencies: `{"dsh-mail-notify":"file:E:/Projects/DSHarness/dsh-mail-notify/dsh-mail-notify-0.5.1.tgz"}`;
- `dsh.profile.bundles`: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless`, **`dsh-mail-notify`**;
- installed `node_modules/dsh-mail-notify/package.json`: **`version 0.5.1`**;
- `compatibility.json` **absent**; no version-exemption store; no `allow-version`, no `--accept-risk`.

`--dump-config` on that profile emits the composed row and no skip diagnostic
(`evidence\27b_candidate_final_dump_config.log`, exit 0):

```yaml
# == dsh-mail-notify
- id: dsh-mail-notify
  name: dsh-mail-notify
  config:
    enabled: false
```

`skippedBundles` absent. (Bundle default is `enabled: false` by design.)

### 4.5 Gate evidence chain, summarised

| Artifact | Declared host requirements | Host installed | Outcome |
| --- | --- | --- | --- |
| Published `dsh-mail-notify@0.5.0` (registry-verified) | `dsh-credentials@0.2.0-rc.2`, `dsh-session@0.2.0-rc.2` (exact) | `0.2.1-rc.2` | **REJECTED, exit 1**, profile restored, no exemption |
| Earlier candidate `dsh-mail-notify@0.5.1` (SHA-256 `50FE12B3…83000`) | `engines.dsh 0.2.1-rc.2`; peers `dsh-credentials@0.2.1-rc.2`, `dsh-session@0.2.1-rc.2` | `0.2.1-rc.2` | **ACCEPTED, exit 0**, bundle mounted, no exemption (§4.2–4.4) |
| **FINAL** `dsh-mail-notify@0.5.1` (SHA-256 `BFB91D4F…F6FF`) | same declaration (identical package.json) | `0.2.1-rc.2` | **ACCEPTED, exit 0**, bundle mounted, no exemption (**§4.6**) |

### 4.6 FINAL artifact acceptance (addendum) — SHA-256 `BFB91D4F…F6FF`

After documentation/comment-only changes, the release candidate was rebuilt. The FINAL artifact was
verified and accepted natively, on the same isolated host (`DSH 0.2.1-rc.2`), with no exemption.

**Artifact verification.** `E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz`,
**204 061 bytes, 113 files, SHA-256 `BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF`**
— matches the supplied hash. Its manifest is byte-for-byte the earlier declared metadata (+ the
documentation change): `version 0.5.1`, `engines.dsh = 0.2.1-rc.2`, peers
`dsh-credentials@0.2.1-rc.2`, `dsh-session@0.2.1-rc.2`, `cordis ^4.0.4`, `schemastery ^3.18.4`, **no
`@deepseek-ai/dsh` peer** (`evidence\34_final_candidate_package.json`). The predecessor
`50FE12B3…83000` is preserved at `E:\Projects\DSHarness\dsh-mail-notify\tmp\phase051\artifact-verified-50FE12B3.tgz`
(verified: same SHA-256, 203 187 bytes). Equivalence proof supplied with the artifact: 113/113 archive
entries present, 107 byte-identical, the 5 differing code files comment-only, `package.json` identical,
and only `README.md` changed deliberately.

**The real attempt — fresh isolated profile.** Profile `candidate-051f`, created from the shipped
`headless` template in the same isolated DSH_HOME (distinct from `gate-test-050`, `candidate-051b`,
the EARLIER candidate's `candidate-051`, and the web-boot profiles):

```powershell
$env:DSH_HOME         = 'E:\Projects\DSHarness\_phase051-compat\runtime\dsh-home'
$env:DSH_INSTALL_ROOT = 'E:\Projects\DSHarness\_phase051-compat\host'
& 'E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin\dsh.cmd' `
    plugin --profile candidate-051f add `
    'E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz'
```

Raw logs: `evidence\35_final_candidate_acceptance_BFB9.{stdout,stderr,combined}.log`.

**Verbatim acceptance (FINAL artifact):**

```text
Progress: resolved 0, reused 0, downloaded 1, added 0
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.

dependencies:
+ dsh-mail-notify file:E:/Projects/DSHarness/dsh-mail-notify/dsh-mail-notify-0.5.1.tgz

Packages: +2
++
Progress: resolved 2, reused 1, downloaded 1, added 2, done
Done in 625ms using pnpm v11.7.0
```

**stderr: empty. Exit code: 0.**

**Post-install state (FINAL).** `evidence\36_final_candidate_installed_state.json`:

- profile `package.json` dependencies: `{"dsh-mail-notify":"file:E:/Projects/DSHarness/dsh-mail-notify/dsh-mail-notify-0.5.1.tgz"}`;
- `dsh.profile.bundles`: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless`, **`dsh-mail-notify`**;
- installed `node_modules/dsh-mail-notify/package.json`: **`version 0.5.1`**;
- `compatibility.json` **absent**; no version-exemption store; no `allow-version`, no `--accept-risk`.

`--dump-config` on `candidate-051f` emits the composed row with no skip diagnostic
(`evidence\37_final_candidate_dump_config.log`, exit 0):

```yaml
# == dsh-mail-notify
- id: dsh-mail-notify
  name: dsh-mail-notify
  config:
    enabled: false
```

`skippedBundles` absent. **The FINAL artifact is therefore natively accepted by DSH `0.2.1-rc.2`
through the real plugin-manager path, with no exemption; the published-v0.5.0 rejection in §3 is
unchanged and remains the contrast case.**

---

## 5. Isolated Web UI boot, browser tooling, onboarding

### 5.1 Boot command (dedicated loopback port)

```powershell
$env:DSH_HOME         = 'E:\Projects\DSHarness\_phase051-compat\runtime\dsh-home'
$env:DSH_INSTALL_ROOT = 'E:\Projects\DSHarness\_phase051-compat\host'
$env:PATH             = 'E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin;' + $env:PATH

& 'E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin\dsh.cmd' `
    --profile compat-web-021 --from-default-profile web `
    --no-open --host 127.0.0.1 --port 51951
```

Runner: `runner/boot-web.ps1 -Port 51951 -Profile compat-web-021 -FromTemplate web` — it checks the
port is free, starts the launcher with redirected logs, waits up to 150 s for the URL line, then writes
`evidence\web-boot-<profile>.json` (profile, port, full URL, wrapper pid, logs, paths).

Observed stdout (`evidence\logs\web-compat-web-021.stdout.log`):

```text
dsh web: http://127.0.0.1:51951/?token=<redacted>
```

**The URL with its `?token=` query is the only usable entry point.** The bare root is fenced:

| Request | Result | Evidence |
| --- | --- | --- |
| `GET http://127.0.0.1:51951/?token=…` | **HTTP 200**, 37 448 bytes, `text/html; charset=utf-8`, `<title>DeepSeek Harness`, `window.__DSH_BOOT__` present | `evidence\16_web_index_authenticated.html` |
| `GET http://127.0.0.1:51951/` (no token) | **HTTP 401 Unauthorized** | `evidence\17_web_bare_root.txt` |

### 5.2 Browser tooling availability

| Tool | Value |
| --- | --- |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`, **155.0.8059.84** |
| Edge (fallback) | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, 156.0.4314.30 |
| Driving method | Chrome `--headless=new` + DevTools Protocol over Node's own global `WebSocket`/`fetch` — **no extra dependency**, the same technique as `scripts/probe/browser-e2e.mjs` |
| Result | `evidence\19_browser_boot_evidence.json` — **7/7 PASS**: real Chrome over CDP; title `DeepSeek Harness`; `window.__DSH_BOOT__` object; `"Failed to load plugins"` absent; `#root` has rendered children; body non-empty after hydration; no candidate plugin installed yet (C4-A expectation) |
| Screenshot | `evidence\18_web_ui_screenshot.png` (boot state, before onboarding dismissal) |
| Chrome profile isolation | `--user-data-dir` always under `...\runtime\chrome-profile-*`; never the operator's browser profile |

CDP drivers written for this task (reusable by C4-B): `runner/cdp-shot.mjs` (open URL, assert boot,
screenshot), `runner/cdp-onboarding-timing.mjs` (dismiss onboarding and measure), `runner/cdp-plugins-page.mjs`
(close sign-in dialog, navigate to Plugins, screenshot).

> Plain `chrome --headless=new --screenshot=…` **hung** on this machine (background GCM/updater retries)
> and produced no file; the CDP driver is the reliable path. Do not use the one-shot `--screenshot` form.

### 5.3 Onboarding / blank-profile gotchas (measured)

A brand-new profile has **two** interactive layers before the app is usable:

1. **"Preview Notice" modal** (blocks the page until acknowledged; `evidence\18_web_ui_screenshot.png`).
   Verified recipe: find the button whose text is `Continue`, click it, then **poll** until
   `document.body.innerText` no longer contains `Preview Notice`. Measured on a fresh DSH profile:
   **dismissed in 515 ms** (`evidence\30_onboarding_dismissal.json`; post-dismissal screenshot
   `evidence\31_web_ui_after_onboarding_ready.png`); the Plugins navigation was reachable afterwards.
   An earlier probe sampled only 1.5 s after its click and still saw the modal (`evidence\21_onboarding_evidence.json`);
   a later browser session on that same DSH instance saw no modal — the acknowledgement is eventually
   persisted (Host-side, not in browser localStorage, which held no notice key). Practical rule: click,
   then poll up to 30 s.
2. **"Get started" sign-in dialog** (`Sign in` / `Add API Key`, with a close X). It does not require an
   account for this work. Verified recipe: click the dialog's close button (the dialog button with an
   empty text label / `aria-label` containing `close`), then the Plugins page is reachable
   (`evidence\33_plugins_page_evidence.json`; screenshot `evidence\32_plugins_page.png`).

The Plugins page (`evidence\32_plugins_page.png`) renders `Plugins — Install, enable, and configure
plugins` with a native **`+ Add plugin`** button; the candidate can therefore be installed either by
the CLI (§6.3, path proven here) or through this UI flow (C4-B to exercise end-to-end).

### 5.4 Loopback SMTP harness (prepared and verified; no real mail)

Harness: the repository's `scripts/probe/live-smtp.mjs` — listens on `127.0.0.1` only, speaks just
enough SMTP for one Nodemailer client, accepts any AUTH, never relays, and appends one JSON line per
accepted message (`{at, bytes, subject}`) to a receipts file.

```powershell
node E:\Projects\DSHarness\dsh-mail-notify\scripts\probe\live-smtp.mjs 25101 <receipts.json>
```

Self-test on this host: full SMTP conversation (`EHLO → AUTH → MAIL FROM → RCPT TO → DATA → QUIT`)
answered correctly and the receipt was written —
`{"at":1792287141662,"bytes":99,"subject":"C4-A loopback SMTP self-test"}`
(`evidence\28_smtp_receipts.json`, `evidence\29_live_smtp_sink.log`). The sink was then stopped; nothing
left listening on 25101.

---

## 6. Runbook for C4-B (Web verifier / candidate E2E)

**Scope note: the host install at `E:\Projects\DSHarness\_phase051-compat\host` is shared with other
verifiers. It is read-only for them: do not modify `host\`, `runtime\` or `evidence\`. Use your own
scratch root (e.g. `...\_phase051-compat\verify-web\`) for your DSH_HOME, profiles, logs and screenshots.**
The launcher itself is used directly from the shared install; that writes nothing into the install.

### 6.1 Prerequisites

- Node `v24.13.0`, npm `11.12.0` (only needed if you reinstall the host); **pnpm `11.7.0` must be on
  `PATH`** — `dsh plugin` forwards to it (`G7`).
- Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` (155.0.8059.84).
- The host launcher: `E:\Projects\DSHarness\_phase051-compat\host\node_modules\.bin\dsh.cmd`.
- The **FINAL** candidate artifact: `E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz`,
  204 061 bytes (SHA-256 `BFB91D4F91F004EF590FD2E4758CC41BF13BB65F0BB06A1ED3F03AEC85A2F6FF`; re-verify
  before use). The earlier `50FE12B3…83000` build is preserved at
  `E:\Projects\DSHarness\dsh-mail-notify\tmp\phase051\artifact-verified-50FE12B3.tgz` (predecessor, not
  the release artifact).
- Repo helpers: `scripts/probe/live-smtp.mjs` (SMTP sink), `scripts/probe/browser-e2e.mjs` (real
  browser assertions; needs a booted instance + URL with token).

### 6.2 Boot the isolated Web UI

```powershell
$root = 'E:\Projects\DSHarness\_phase051-compat\verify-web'      # your own root
$env:DSH_HOME         = Join-Path $root 'dsh-home'               # MUST be isolated, created if absent
$env:DSH_INSTALL_ROOT = 'E:\Projects\DSHarness\_phase051-compat\host'
$env:PATH             = (Join-Path $env:DSH_INSTALL_ROOT 'node_modules\.bin') + ';' + $env:PATH
$port = 51961                                                    # pick a free dedicated loopback port
$profile = 'c4b-web'
# first use of a profile name must create it from the shipped template in the same invocation
Start-Process -FilePath $env:ComSpec -NoNewWindow -PassThru `
  -ArgumentList ('/d /s /c ""' + (Join-Path $env:DSH_INSTALL_ROOT 'node_modules\.bin\dsh.cmd') +
    '" --profile ' + $profile + ' --from-default-profile web --no-open --host 127.0.0.1 --port ' + $port + '"') `
  -WorkingDirectory $env:DSH_HOME `
  -RedirectStandardOutput (Join-Path $root 'web.stdout.log') `
  -RedirectStandardError  (Join-Path $root 'web.stderr.log')
```

Wait until `web.stdout.log` contains `dsh web: http://127.0.0.1:<port>/?token=<token>`; that full URL
is the browser entry. Readiness check: `Invoke-WebRequest` on it returns HTTP 200 (~37 KB,
`<title>DeepSeek Harness`). Bare root returns 401 by design.

**Install the candidate before booting** when possible (a new bundle row composes at boot; the shipped
web template uses `patchReload: startup`, and the README says restart after installing). If the
instance is already running, install and then **restart** it.

### 6.3 Install the candidate natively (CLI path — proven in §4)

```powershell
& (Join-Path $env:DSH_INSTALL_ROOT 'node_modules\.bin\dsh.cmd') `
    plugin --profile $profile add `
    'E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.1.tgz'
```

Acceptance criteria: exit 0; stdout `+ dsh-mail-notify file:…`; stderr empty; profile `package.json`
gains the file spec and `dsh.profile.bundles` gains `dsh-mail-notify`; `compatibility.json` **absent**;
`--dump-config` shows `# == dsh-mail-notify` with `enabled: false`. UI alternative: Plugins →
`+ Add plugin` (the button is present; C4-B to exercise).

Then boot/restart the instance (§6.2) and drive the page.

### 6.4 Browser automation

- Handle onboarding first (§5.3): click `Continue` on `Preview Notice`, poll until gone; close the
  `Get started` dialog; then navigate via the `Plugins` button.
- CDP pattern (no dependency): launch Chrome `--headless=new --remote-debugging-port=<free> --user-data-dir=<your root>\chrome-profile --no-first-run --no-default-browser-check --disable-extensions --disable-gpu --window-size=1600,1200 <token-URL>`;
  poll `http://127.0.0.1:<cdp>/json/list` for the page target; drive with `Runtime.evaluate` /
  `Page.captureScreenshot`. Reference implementation: `runner/cdp-shot.mjs` and
  `scripts/probe/browser-e2e.mjs` (26-assertion harness; env: `PROBE_WEB_URL`, `PROBE_CHROME`,
  `PROBE_CDP_PORT`, `PROBE_CHROME_DATA`, `PROBE_SMTP_PORT`, `PROBE_OUT`).
- Do **not** drive a real model Turn from the Web UI (the web profile composes the real provider and
  would spend real quota). Notification families are covered by the scripted-provider probes.

### 6.5 Loopback SMTP settings for the Web card

Start the sink: `node scripts\probe\live-smtp.mjs 25101 <your root>\smtp-receipts.json`.
Configure the plugin card with: **SMTP host `127.0.0.1`**, **Port `25101`**, **Security none** (plain
SMTP, no TLS), **Username** any non-empty value (the sink accepts any AUTH), **From**/**Recipients**
loopback addresses, and set the write-only password Credential control to any disposable value.
The card ships `enabled: false`, so a Save that activates it is required before a Test Email can arrive.

### 6.6 Reading status, config and logs

- Composed row / effective config: `dsh --profile <profile> --dump-config` (same isolated env).
- Persisted Web configuration: `<DSH_HOME>\profiles\<profile>\cordis.patch.yml`.
- Install diagnostics: `<profile>\.plugin-manager\logs\operation-*\pnpm.log` (on success it is empty;
  on rejection it carries the Host's message, as quoted in §3.3).
- Plugin structured log lines (`plugin.ready`, `notification.*`, `plugin.config-invalid`,
  `mail.failed`, …) require an exporter — the `dsh` CLI registers none. The browser harness reads
  Host RPC envelopes over CDP instead (the write path answers HTTP 200 on refusal too; judge by the
  envelope's `ok` field, never the HTTP status — see `scripts/probe/README.md`).
- Runtime status fields (queue/running/SMTP readiness) are on the plugin's card in the Web UI.

### 6.7 Teardown

```powershell
# stop only processes whose command line matches YOUR scratch root AND your profile name
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" |
  Where-Object { $_.CommandLine -like ('*' + $env:DSH_HOME + '*') -and $_.CommandLine -like '*--profile c4b-web*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

`runner/stop-web.ps1 -Profile <name> -Port <port>` implements exactly this (it also cross-checks that
the profile command line carries the isolated root). `Get-NetTCPConnection` was **unreliable** in this
environment — it reported no listener for a live server, so match processes, then probe HTTP to confirm
the port stopped answering. Before any recursive delete, resolve and print the absolute path and verify
it starts with your scratch root; never delete outside it.

### 6.8 Gotchas discovered (worth repeating)

- **G1 — inherited real `DSH_HOME`.** The harness shell exports `DSH_HOME=C:\Users\20659\.dsh`.
  A bare `dsh` command would use it. Always export the isolated value and print it before invoking.
- **G2 — profile creation.** A new profile name needs `--from-default-profile <template>` in the same
  invocation; the launcher refuses a target directory that already exists. Do not pre-create it.
- **G3 — token URL.** The printed URL carries the instance token; the bare origin is 401. Read the URL
  from the launcher's own stdout line; do not guess a token.
- **G4 — onboarding.** `Preview Notice` (click Continue, poll ≤30 s) then `Get started` (close X) come
  before the app is usable; screenshots of a "blank profile" will otherwise show them.
- **G5 — install vs. boot order.** Install the bundle before boot, or restart the Web instance after
  installing; a running instance does not compose the new row.
- **G6 — fixed ports.** This host accepted `--port 51951`/`51952`; the earlier `0.1.7`-era
  `EADDRINUSE` problem was not reproduced. If a port is taken, `--port 0` is supported and the printed
  URL carries the OS-chosen port.
- **G7 — pnpm.** `dsh plugin` forwards to `pnpm` on `PATH`; if missing it prints
  `dsh: pnpm was not found; install pnpm and make it available on PATH.` (`exitCode 127`). This host
  has pnpm `11.7.0`.
- **G8 — no one-shot headless screenshot.** Use the CDP driver (§5.2); `--screenshot` hung.
- **G9 — shared install.** Other verifiers concurrently use the same `host\` install; never modify or
  reinstall it while they run, and never kill processes whose command line does not carry your profile.
- **G10 — gate is real, not advisory.** A rejected install leaves the profile restored and creates no
  compatibility file; do not add a bypass to make an incompatible artifact install.

---

## 7. Evidence index (exact paths)

All under `E:\Projects\DSHarness\_phase051-compat\`:

| # | Path | What it proves |
| --- | --- | --- |
| 01 | `evidence\01_host_install_npm.log` | host install command result, `613 packages`, exit 0 |
| 02/03 | `evidence\02_npm_ls_depth0.json`, `03_npm_ls_dsh.json` | top-level tree; `@deepseek-ai/dsh@0.2.1-rc.2` |
| 04/05 | `evidence\04_lock_dsh_entry.json`, `05_lock_all_deepseek_pkgs.json` | exact resolved versions/integrity (364 entries) |
| 06 | `evidence\06_dsh_version.log` | `dsh --version` → `0.2.1-rc.2` |
| 07–10 | `evidence\07_registry_v050_dist.json`, `08_npm_pack_v050.log`, `09_published_artifact_hashes.json`, `10_published_v050_package.json` | published v0.5.0 provenance + hashes/peers |
| 11 | `evidence\11_profile_init_gate_test.log` | gate-test profile created from template |
| 12 | `evidence\12_gate_attempt_published_v050.{stdout,stderr,combined}.log` | **real rejection, exit 1** |
| 13 | `evidence\13_plugin_manager_diagnostics\logs\operation-gJynWY\pnpm.log` | manager's own operation log |
| 14 | `evidence\14_profile_state_after_rejection.json` | profile restored, `compatibility.json` absent |
| 15 | `evidence\15_gate_rejection_verbatim.md` | consolidated rejection record |
| 16/17 | `evidence\16_web_index_authenticated.html`, `17_web_bare_root.txt` | Web boot HTTP 200 vs 401 |
| 18 | `evidence\18_web_ui_screenshot.png` | real Chrome screenshot of isolated Web UI |
| 19 | `evidence\19_browser_boot_evidence.json` | browser boot 7/7 PASS + Chrome version |
| 20/21 | `evidence\20_web_ui_after_onboarding.png`, `21_onboarding_evidence.json` | early onboarding probe (1.5 s sample caveat) |
| 22/23 | `evidence\22_candidate_artifact_hash.json`, `23_candidate_package.json` | all candidate hashes/status (superseded `D6383C…`, earlier `50FE…`, FINAL `BFB9…`) + manifest |
| 24b | `evidence\24b_profile_init_candidate_051b.log` | earlier-candidate profile created from template |
| 25b | `evidence\25b_candidate_acceptance_final_051.{stdout,stderr,combined}.log` | **earlier candidate (`50FE…`) acceptance, exit 0** |
| 26b | `evidence\26b_candidate_final_installed_state.json` | earlier candidate: `dsh-mail-notify@0.5.1`, bundle gained, no exemption |
| 27b | `evidence\27b_candidate_final_dump_config.log` | earlier candidate: composed `dsh-mail-notify` row, no `skippedBundles` |
| 34 | `evidence\34_final_candidate_package.json`, `34_profile_init_candidate_051f.log` | FINAL artifact manifest + fresh profile created |
| 35 | `evidence\35_final_candidate_acceptance_BFB9.{stdout,stderr,combined}.log` | **FINAL artifact acceptance, exit 0, verbatim** |
| 36 | `evidence\36_final_candidate_installed_state.json` | FINAL: installed `dsh-mail-notify@0.5.1`, bundle gained, `compatibility.json` absent, no exemption |
| 37 | `evidence\37_final_candidate_dump_config.log` | FINAL: composed `dsh-mail-notify` row, no `skippedBundles` |
| 28/29 | `evidence\28_smtp_receipts.json`, `29_live_smtp_sink.log` | loopback SMTP harness verified |
| 30/31 | `evidence\30_onboarding_dismissal.json`, `31_web_ui_after_onboarding_ready.png` | dismissal measured 515 ms; ready UI |
| 32/33 | `evidence\32_plugins_page.png`, `33_plugins_page_evidence.json` | Plugins page + native `+ Add plugin` reachable |
| — | `evidence\web-boot-compat-web-021.json`, `web-boot-compat-web-022.json` | per-instance boot state |
| — | `evidence\logs\web-*.{stdout,stderr}.log` | launcher stdout carrying the token URL |
| — | `evidence\published-v050\dsh-mail-notify-0.5.0.tgz` | registry-downloaded published artifact |
| — | `runner\isolated-env.ps1`, `dsh.ps1`, `boot-web.ps1`, `stop-web.ps1`, `attempt-gate.ps1` | reproducible runners (env guard, boot, teardown, install attempt) |
| — | `runner\cdp-shot.mjs`, `cdp-onboarding-timing.mjs`, `cdp-plugins-page.mjs` | CDP drivers (boot evidence, onboarding, Plugins page) |

Superseded history retained: `evidence\24_profile_init_candidate_051.log`, `25_candidate_acceptance_051.*`,
`26_candidate_installed_state.json`, `27_candidate_dump_config.log` (the superseded `D6383C…` build — not
either later artifact). The earlier `50FE…` acceptance files (`24b/25b/26b/27b`) are kept as the accepted
predecessor's evidence; `34–37` are the **FINAL artifact's** evidence. `runner\cdp-onboarding.mjs` and
`cdp-onboarding-dismiss.mjs` are superseded by `cdp-onboarding-timing.mjs` (kept for provenance).

---

## 8. What could not be verified, and why

1. **The host's upstream commit.** `687f282e8625c6b8d11ff58211a90524be2e4317` is recorded as supplied;
   the npm tarball carries no `gitHead` and this task did not fetch upstream git. Version is proven
   from the installed artifact (`dsh --version`, lockfile), commit is not.
2. **Gate internals / message wording stability.** Behaviour was measured, not read: exact-mismatch
   rejection with profile restore, and the `requirements` vs `peerDependencies` wording delta between
   `0.2.0-rc.2` and `0.2.1-rc.2`. The internal decision code was not source-audited here (C1 covers
   source contracts).
3. **Exemption path.** Deliberately untested: no `allow-version`, `--accept-risk`, or compatibility
   file was created at any point.
4. **Candidate UI install end-to-end.** The `+ Add plugin` control was located and the page reached,
   but the candidate was installed through the CLI; the UI install flow will be exercised by C4-B.
5. **Candidate runtime behaviour.** Card render, Save/commit, credential write, Test Email delivery and
   notification E2E are C4-B/C3 scope; C4-A only proves the host accepts the metadata and the Web
   environment can be driven.
6. **Plugin-level SMTP delivery.** The loopback sink was verified with a hand-written SMTP client, not
   yet with the candidate's mailer (C4-B).
7. **Onboarding persistence internals.** The acknowledgement survives new browser sessions against
   the same DSH instance; the storage location was not inspected (no key was present in browser
   localStorage). Recipe is stated behaviourally (poll until gone).
8. **Other verifiers' concurrent use.** At the time of writing, processes for `verify-web` and
   `verify-probes` were using the shared host install on other ports; they were left untouched and are
   not part of this document's evidence.
9. **`npm audit` on the host tree** reports 8 moderate advisories in host tooling dependencies; this
   task did not attempt to remediate the host (out of scope, and modifying the shared install is
   forbidden). The plugin's own dev tree is reported separately by the Lead (0 vulnerabilities after
   dropping the root dsh peer).

---

## 9. Safety attestation

- The operator's real `DSH_HOME` (`C:\Users\20659\.dsh`) was **never** used as a DSH home: it was only
  inspected for its directory timestamp (read-only metadata) as an isolation check; the harness itself
  writes its own session records there, as in every prior phase. No credentials, SMTP secrets, session
  stores, or production profiles were read, copied, or written by this task.
- Every DSH invocation ran with the exported isolated `DSH_HOME`, printed into its log by
  `runner/isolated-env.ps1`. The inherited real-home value is explicitly overridden and logged.
- Recursive deletes: none outside the scratch root. Web instances were torn down by process-command-line
  match scoped to the scratch root + profile; other verifiers' processes were not touched.
- SMTP was loopback-only on `127.0.0.1:25101`; no mail left the machine. No model calls were made.
- No `npm publish`, no git commit/tag/push, no `main` changes, no `package.json`/`src`/`tests` edits.
  The only repository file written by this task is this document.
- No `accept-risk` / `allow-version` / compatibility-exemption / peer-bypass was used; the rejection is
  recorded as fact and the published artifact stays unmodified.
- Registry: `@deepseek-ai/dsh@0.2.1-rc.2` installed exactly on the first attempt with no
  release-age/cooldown refusal; no fallback to `0.2.0-rc.2`.

**Status:** C4-A complete. C4-B can start from §6; the host install and runners are in place.
