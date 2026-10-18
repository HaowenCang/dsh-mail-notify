# DSH host contract diff — dsh-mail-notify compatibility audit (C1-A)

**Verdict scope:** source-level contract comparison of the two released DSH host tags named below, for every host surface the `dsh-mail-notify` plugin consumes, plus the install/compat gate that decides whether the plugin is admitted at all.

| | |
|---|---|
| OLD host tag | `dsh-v0.2.0-rc.2` = commit `639ed015397290b3745d163aafe02ffee4aa3f84` |
| NEW host tag | `dsh-v0.2.1-rc.2` = commit `687f282e8625c6b8d11ff58211a90524be2e4317` |
| Source clone | `E:\Projects\DSHarness\dsh-v0.2.0-rc.2-source` (partial `blob:none` clone of `deepseek-ai/deepseek-harness`, tags fetched) |
| Plugin audited | `dsh-mail-notify` @ `0.5.1` working tree (`compat/dsh-0.2.1-rc.2` branch; metadata bump uncommitted by Lead). Baseline released `0.5.0` metadata also recorded below. |
| Method | `git show <tag>:<path>`, `git diff <old> <new> -- <path>`, `git grep <pattern> <tag> -- <path>`, `git ls-tree`; no checkout, no writes to the clone; plugin repo read-only for this task. Every cited line was read from the tag's tree (not from `origin/master`). |
| Date | 2026-10-17 (America/Los_Angeles) |
| Tools | git 2.x (partial clone over network), PowerShell `Select-String` for tag-relative line numbering, `read`/`grep` on verified dumps of tag snapshots |

**How to read citations.** `path:line` means that path **at that tag**. Where a file is byte-identical between tags, one line number is valid for both and is stated explicitly ("identical at both tags; `git diff --stat` empty"). "Absence of change" is distinguished from "absence of surface": a surface listed as *same* was confirmed to exist at both tags with identical source; a surface listed as *absent* was searched for and not found, which is stated only where relevant.

**Audit-time caveat.** The plugin working tree was modified by the Lead during this audit (0.5.0 → 0.5.1 metadata bump, uncommitted). Source evidence in this file is host-side only; the plugin's declared values below were read from the working-tree `package.json` at the time of writing (line numbers of that uncommitted file are advisory).

---

## 0. Overall verdict table

| # | Surface | CHANGE_CLASS | One-line finding | Plugin action |
|---|---|---|---|---|
| G1 | Install/compat gate algorithm (`engines.dsh` vs dsh peers) | **breaking** (for plugin metadata) | NEW: an own `engines.dsh` decides alone and peers are ignored; OLD: only dsh peers were read. 0.5.0's pinned `0.2.0-rc.2` peers fail on a 0.2.1 host. | Add `engines.dsh` (0.5.1 bump does this); or move dsh peers to a range covering the runtime. Advisory only. |
| G2 | Plugin manager install/upgrade rejection path | compatible | Same `incompatible-version` refusal flow; NEW adds `already-installed` under HMR, `restartReason`, engines-aware preflight lookup. | None required. |
| G3 | HMR reload machinery (dispose/re-subscribe) | compatible | NEW replaces changed-profile-package code in place (stop entries → evict modules → recompose/start); OLD required restart for package version replacement. Fiber-owned listeners dispose/re-subscribe exactly once. | Verify at runtime (duplicate-listener check); keep listeners fiber-owned. |
| S1 | `SessionEvent` envelope | same | Envelope (`type/seq/time/data/ignorable/surfaceOp/sourceEventSeqs`) unchanged. NEW adds a separate `plugin:` record vocabulary (additive). | None. |
| S2 | `turn/end` + `TurnEndReasonMap` | same | Payload `{turn, reason}` and the 8 reason variants unchanged. | None. |
| S3 | `assistant/message` (+ `usage`) | same | Payload/fields unchanged, including `usage?: TokenUsage`, `stream`, `interrupted`. | None. |
| S4 | `user/message` + `MessageSource.kind` | same | `user/message: UserMessage` unchanged; base `{kind:'user'}` unchanged; NEW adds optional `principal` to the `user-rpc` augmentation only. | None. |
| S5 | `tool/call` | same | `{turn, step, callId, name, arguments}` unchanged. | None. |
| S6 | `tool/result` | same | `{turn, step, message, error?, meta?}` unchanged. | None. |
| S7 | Approval audit events (`approval/asked`, `approval/decided`) | same | Types and service flow byte-identical; only the package's unused `invariant.ts` was deleted and version bumped. | None. |
| S8 | timed `ask_user_question` (timeout non-error + late reply) | same | `tool-ask-user` and `user-questions` sources are byte-identical between tags; `{pending:true,callId}` timeout result and `user-question-reply` late-reply source unchanged. | None. |
| S9 | `SessionHeader` / session source classification | same | `origin?: 'subagent'`, `delegationDepth?`, `parentSession?`, `isSeeded`, `agentPreset?` unchanged (only doc line shift). | None. |
| S10 | Token usage / telemetry "schema v2" (host side) | same | `TokenUsage` unchanged; `assistant/message.usage` is still the per-call accounting surface. "schema v2" is the plugin's own DTO version. Host OTel package changes are exporter-internal. | None. |
| C1 | Credential provider API (`resolve/describe/set/unset`) | **compatible** (API) / behavior change | Signatures and `CredentialInfo` unchanged. Read priority **inverted**: stored `.credentials.yaml` now wins over process env; `describe().writable` now true for env-sourced refs; env-shadow writes no longer rejected. | Review UI copy/contract tests; no code change strictly required. |
| V1 | Volatile configuration + `loader/volatile-update` | same | Event name/signature and volatile-commit/emit path unchanged; the only loader source delta is `Entry.moduleNamespace` for HMR namespace tracking (no volatile-path change); cordis/schemastery/cosmokit sources identical, versions bumped. | None. |
| X1 | `configForms` (`ConfigForm`/`ConfigFormSnapshot`, `get`, `whileServed`) | **compatible** | `ConfigFormSnapshot.mode` and client-selected `memory` persistence removed at NEW; `get()`/`whileServed()`/`set/mutate/unset` unchanged. Plugin does not read `.mode`. | None; remove any future reliance on `.mode`/memory mode. |
| X2 | `plugins.bundle.config` slot | same | Same keyed root slot with same owner props (`PluginConfigViewProps` unchanged). NEW adds unrelated `plugins.tab`/`plugins.add.actions` slots. | None. |
| X3 | `connection.fetch.register` | **compatible** | Route descriptor and single-arg `fetch(request)` unchanged; NEW dispatch admits only owner Peers to exact routes (403 otherwise). Plugin's Web card is the owner Peer. | None; runtime check for non-owner callers if any. |
| X4 | `connection.rpc.call` | same | Client RPC caller source byte-identical (`call(channel, endpoint, payload, signal)`), server envelope unchanged for plugin's `/api` channel. | None. |
| P1 | Client package exports/subpaths used by plugin half | compatible (source) | `./client` subpaths still exist for all six injected packages; `ui-slots` still a runtime package at NEW in source; `ui-settings` snapshot field removal and `ui-plugin-manager` slot/type additions are the only contract deltas. Installed-tree presence of `ui-slots` is **unverified** (packaging, not source). | Verify target host's installed tree; otherwise no code change. |

Bold = a change the release decision must account for.

---

## 1. Install/compat gate (`packages/boot/app-boot/src/plugin-compatibility.ts`)

### 1.1 Runtime version source (identical shape at both tags)

- `getDshRuntimeVersion()` reads **this app-boot package's own `package.json`**, through a filesystem path so the executable's virtual filesystem works: `packages/boot/app-boot/src/plugin-compatibility.ts:44-49` at both tags. Validates that the value is a valid semver string (`runtimeVersionOf`, same file `:24-29`), otherwise throws `Invalid dsh runtime version: …; expected a semantic version`.
- The actual value at each tag: `packages/boot/app-boot/package.json:4` — OLD `0.2.0-rc.2`, NEW `0.2.1-rc.2`. The CLI's `--version` prints exactly this value: `apps/cli/src/bin.ts:27` (`const version = getDshRuntimeVersion()`), and the CLI package itself is `@deepseek-ai/dsh` with matching version (`apps/cli/package.json` version field at both tags).
- Call sites that pass no explicit runtime version therefore use the app-boot version: `compatibility-preflight.ts:105`, `profile.ts:760` (NEW) / `profile.ts:675` (OLD), `plugin-manager/src/operations.ts:345,480` (NEW) / `344,479` (OLD), `plugin-manager/src/index.ts:366,625,815` (NEW) / `301,546,722` (OLD). Only `plugin-market` passes an explicit runtime version (`packages/boot/plugin-market/src/index.ts:353`, NEW package) with the same default.
- Documented semantics: `packages/boot/app-boot/README.md:131` at both tags ("Runtime version. `getDshRuntimeVersion()` reads this package's manifest … missing or invalid versions fail rather than bypassing compatibility checks.").

### 1.2 OLD algorithm — `dsh-v0.2.0-rc.2`

File `packages/boot/app-boot/src/plugin-compatibility.ts` at OLD (103 lines total):

- `evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion())` at `:61-88`.
- No `peerDependencies` own-property → return `undefined` (`:68`). `engines` is **never read** at OLD.
- For every own `peerDependencies` entry: non-string range throws (`:72-74`); names other than `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` are skipped (`:75`); `workspace:^`, `workspace:~`, `workspace:*` are replaced by the runtime version (`:76`); the range is compared with `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`, and an empty/whitespace range is unmet (`:77-79`).
- Any unmet peer(s) → result `{ name, version, runtimeVersion, peers, exempted }` (`:8-15`, `:81-87`); `exempted` is true only when the profile exemptions map exactly `name@version` to a list containing the exact runtime version (`:84-86`).
- Diagnostics: `pluginCompatibilityWarning` renders `Plugin <name>@<version> is incompatible with dsh <runtime>: peerDependencies <JSON>. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for <key> on dsh <runtime> with \`dsh plugin allow-version\` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: <active|not active>.` (`:96-103`).
- Documented: `packages/boot/app-boot/README.md:52` at OLD — "…checks its `peerDependencies` … These checks use peer declarations, not `engines.dsh`…".

### 1.3 NEW algorithm — `dsh-v0.2.1-rc.2`

File `packages/boot/app-boot/src/plugin-compatibility.ts` at NEW (117 lines total):

1. Validate the runtime version (`:24-29`), then parse the manifest as an object (`:17-22`).
2. `unmetRequirements(fields, runtimeVersion)` (`:55-74`):
   - `engines` present must be an object, else throws `Plugin manifest engines must be an object` (`:56`).
   - **If an own `engines.dsh` exists** (`:57`): it must be a string (`:59`), and `satisfies(runtimeVersion, range)` decides alone (`:60`). `peerDependencies` are **not read at all** on this branch.
   - Otherwise, if no own `peerDependencies`, no requirement (`:62`).
   - Otherwise every own peer named `@deepseek-ai/dsh` or prefixed `@deepseek-ai/dsh-` must satisfy (`:65-72`); `workspace:^`, `workspace:~`, `workspace:*` are replaced by the runtime version (`:70`); unchanged.
3. `satisfies(runtimeVersion, range)` = `range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })` (`:51-53`). Consequences: empty/whitespace ranges are unmet; invalid ranges (including any `workspace:` value in `engines.dsh`) are unmet; prereleases participate; a bare `*` matches.
4. On unmet requirements: identity fields required (`:31-37`, error text now "when dsh requirements are unmet"), exemption key `name@version` must list the exact runtime version (`:96-101`), result shape renamed **`requirements`** (was `peers`): `{ name, version, runtimeVersion, requirements, exempted }` (`:8-15`).
5. `pluginCompatibilityWarning` now says `requirements ${JSON.stringify(issue.requirements)}` instead of `peerDependencies …` (`:110-117`); the rest of the wording is byte-identical.
6. Documented: `packages/boot/app-boot/README.md:52` at NEW — "When the manifest declares `engines.dsh`, that range alone decides and `peerDependencies` are ignored… empty or invalid ranges, including a `workspace:` value in `engines.dsh`, are incompatible. A non-object `engines` or a non-string `engines.dsh` is a malformed manifest. A refusal names the unmet requirements, keyed `engines.dsh` or by peer package name."

Exemption file (unchanged between tags; `packages/boot/app-boot/src/profile-compatibility.ts` is not in the tag diff):
- filename `compatibility.json` (`:10`), format `exact package-name@version -> [exact DSH versions]` (`:42-53`, `:62-93`), reader `readProfileVersionExemptions` (`:99-101`), writer `setProfileVersionExemption` (`:113-140`) requiring `--accept-risk` for grants (`:117-119`) and requiring the runtime version to equal `getDshRuntimeVersion()` (`:120-123`). Malformed file never stops startup; records it rejects are ignored and the file becomes read-only for grants (`:62-93`, README `packages/boot/app-boot/README.md:56` at both tags).

### 1.4 What counts as the "dsh version", matching semantics, exact errors

- **Version source:** `@deepseek-ai/dsh-app-boot` package manifest version (see 1.1). Not `engines.node`, not the plugin manager version, not the CLI version as a separate value — the CLI prints the same value (`apps/cli/src/bin.ts:27`).
- **Semver matching:** exact `semver.satisfies(…, { includePrerelease: true })`, one range per requirement. Exact version strings match themselves (so a pinned `"0.2.1-rc.2"` matches runtime `0.2.1-rc.2`); a pinned `"0.2.0-rc.2"` does **not** match `0.2.1-rc.2`. `^0.2.1-rc.2` also matches `0.2.1-rc.2` under `includePrerelease`; `>=0.2.0-rc.2 <0.3.0` matches both runtimes.
- **Error produced (function-level):** `pluginCompatibilityWarning` string above (NEW `:110-117`). It is not an exception by itself; each caller turns it into its own surface:
  - **Install preflight (CLI/service):** `packages/boot/plugin-manager/src/operations.ts:324-352` (NEW) / `:323-352` (OLD). A named `add`/`install` spec's manifest is read before pnpm (`:333-351`); an unmet requirement appends the warning and aborts with `installation rejected: <warnings>` + `nothing was installed` (`:352`, `:324-332`), exit code 1. The CLI prints the exact exemption command (`apps/cli/src/plugin.ts:99-101`, file identical at both tags): `dsh: to accept the risk, run: dsh plugin --profile <profile> allow-version <name>@<version> --dsh-version <runtimeVersion> --accept-risk`.
  - **Post-install validation (git/tarball or bundle components):** `operations.ts:466-518` (NEW) / `:465-517` (OLD) — `pnpm` has already run; on unmet requirements the profile `package.json`/`pnpm-lock.yaml` are restored, `node_modules` reinstalled from the restored lockfile where possible, result reports `installation rejected` with `restored …` (`:500-519` NEW / `:499-518` OLD).
  - **Plugin manager refusal code:** `ManagementError.code = 'incompatible-version'` with `incompatible: IncompatiblePlugin[]` carrying `{ name, version, runtimeVersion, requirements }` (NEW `packages/boot/plugin-manager/src/types.ts:11-25`) vs `{ …, peers }` (OLD `types.ts:12-25`). Raised in `index.ts:366,585,625` (NEW) / `:302,510,546` (OLD); a compatibility refusal during a registry install stops further registry retries (`index.ts:584-585` NEW).
  - **Startup, bundle layer:** a selected bundle whose own manifest fails is skipped like an unreadable one and listed in `skippedBundles` (`packages/boot/app-boot/src/profile.ts:740-767` NEW / `:655-682` OLD; check at `:759-761` NEW / `:674-676` OLD), printed by `reportSkippedBundles` (`profile.ts:118-127` at both tags). The bundle's rows never load.
  - **Startup, plugin row:** `prepareProfileEntries`/`prepareProfilePatches` run preflight over the composed entry list; a denied ordinary row becomes `disabled: true` with a stderr line `disabling profile plugin <row|name>: <reason>` and is never imported (`packages/boot/app-boot/src/compatibility-preflight.ts:74-84, 89-169, 180-187`; denial at `:101-118` NEW, `:101-118` OLD with only the catch message reworded at `:108-111`). Callers: `packages/boot/app-boot/src/index.ts:388,774` (NEW) / `:288,569` (OLD).
  - **Plugin manager list/inspect surfaces:** `listBundles` raises the same `incompatible-version` when reading a bundle manifest (`index.ts:366` NEW / `:302` OLD); `inspect` reports an `already-installed` problem, not compatibility.
  - **Exemption path:** granting the pair makes `issue.exempted === true`, which every caller treats as admitted (`compatibility-preflight.ts:106`; `profile.ts:761`; `operations.ts:346`; `index.ts:365-366`).
- **What does NOT happen:** the gate does not import or evaluate plugin code (module comment, both tags); it is not a sandbox (`README.md:52` both tags).

### 1.5 Plugin manager install/upgrade behavior (OLD vs NEW)

Common to both: install runs pnpm in the profile dir, writes the profile manifest, selects the bundle after success, restores files on failure (`plugin-manager/README.md` OLD §`installBundle`, NEW `:69,:100`). HMR-enabled profiles apply changes live; startup-only profiles report `restart-required` (`README.md` OLD `:26-27`, NEW `:26`).

NEW-specific behavior (source + README):
- Compatibility preflight now asks the registry for `engines` as well as `peerDependencies` and uses both for the decision: `operations.ts:158-178` (view fields at `:178` include `engines peerDependencies`; OLD `:178` had `peerDependencies` only). Documented in `plugin-manager/README.md:69` NEW.
- With HMR, installing a package that is already installed (same name) is refused **before pnpm** with `already-installed` (`index.ts:537-545`; `types.ts:22` adds the code; README `:100` NEW). Removing and reinstalling is the upgrade path; previous plugins stop and modules are evicted first. OLD had no such refusal: reinstalling over an existing dependency returned `restart-required` (`index.ts:561-562` OLD), i.e. an upgrade never applied live.
- Every `restart-required` result now carries `restartReason` (`no-hmr|package-moved|host-module|unmanaged-plugin|module-comparison`): `types.ts:35,136` NEW; `index.ts:907` sets `{application:'restart-required', restartReason:'no-hmr'}` for startup-only profiles; `index.ts:886-895` maps HMR `pending` reasons. OLD `ChangeResult` had no `restartReason` (`types.ts:112-133` OLD; `index.ts:773-789` OLD).
- Live application path changed: OLD `reload()` called `reconcileProfilePatches(...)` (`index.ts:762-764` OLD); NEW has `refreshPackages()` + `publishAndReload()` + `reload()` using `hmr.reconcileProfile(requiredIds)` (`index.ts:859-895` NEW), called after install/enable/remove (`:646,716` NEW). NEW also refuses a `link:`/git spec known only after pnpm under HMR only for the "known package" cases; documented in README `:100` NEW.
- Official on-demand catalog (`packages/boot/plugin-market`, new package at NEW) reuses the same `installBundle`/`evaluatePluginCompatibility` path; it adds no extra version admission rule (`plugin-manager/README.md` NEW; `plugin-market/src/index.ts:353`).
- Registry install uses the same preflight refusal, so a plugin with unmet dsh requirements is never downloaded and no build script runs (`plugin-manager/README.md:69` NEW).

No install/upgrade behavior requires a plugin code change; it only requires the metadata to pass the gate.

### 1.6 HMR reload machinery — what is disposed / re-subscribed

OLD (`@deepseek-ai/dsh-hmr`, `packages/boot/hmr/src/index.ts` at OLD):
- Module reloads replace changed modules and keep it to module-cache surgery; profile configuration reload delegated to `reconcileProfilePatches` (`hmr/src/index.ts:198` Service.init, `:230` calls it). Known limitation stated in `hmr/README.md:89` OLD: "Replacing installed package versions still requires a restart through Plugin Manager."
- Plugin manager never replaced a package version live: reinstall over an existing dep → `restart-required` (`plugin-manager/src/index.ts:561-562` OLD).

NEW (`@deepseek-ai/dsh-hmr`, mostly rewritten, `packages/boot/hmr/src/index.ts`):
- Profile recomposition now also replaces plugins whose loaded files below the profile dir (including `node_modules` and linked-package targets) changed on disk (`hmr/README.md:48,63,67-71` NEW; code: `reconcileProfile()` at `hmr/src/index.ts:925-975`, comparison through `ModuleFiles`/`PackageManifests` (`hmr/src/index.ts:16-17,259-260`; modules `packages/boot/hmr/src/module-files.ts`, manifests `packages/boot/hmr/src/package-manifest.ts`), eviction `:753-760`, stop plan `:874-882`).
- Disposal order on a package/code change: files compared → changed modules and their importers **evicted from the ESM `loadCache` and CommonJS `require.cache` without a backup** → the Loader entries running affected plugins are **stopped** (`stopPlanned` `:874-882`: manifests invalidated, modules evicted, `ctx.registry.delete(plugin)` then `await fiber.await()`) → app-boot's single `recomposeProfile()` (`packages/boot/app-boot/src/index.ts:307` NEW) publishes runtime resolution, applies the generation and **starts the stopped entries again** (`hmr/src/index.ts:969`). Stopping a Loader entry disposes its fiber, which runs the plugin's `ctx.effect`/`ctx.on` disposers (this is the ordinary Cordis fiber teardown); starting it re-runs the plugin's `apply`, so listeners and services are re-subscribed exactly once into a new fiber. Disabled/removed/incompatible rows are never imported by HMR (`hmr/README.md:67` NEW).
- New `restartReason` vocabulary: `module-comparison`, `package-moved` from HMR (`hmr/src/index.ts:996-1024` NEW: `ReplacementPlan`, `ProfileReconciliation`, `PendingModule`), surfaced by plugin manager (1.5).
- Failure handling: a replacement that fails to import/start is an activation failure, previous code no longer runs, and later recompositions retry (`hmr/README.md:69` NEW). Before any stop, failure leaves everything running (`:69`).
- Volatile-only configuration changes still commit in place without remount (`hmr/README.md:60` NEW, `vendor/loader` below).
- Watch setup: config paths watched via `watchConfig` (`hmr/src/index.ts:289,406-407` NEW), module/manifest comparison recorded at application readiness (`:355-410` NEW).

What the plugin does on stop/start (existing source, unaffected): the plugin's event listeners and one volatile-config listener are registered on the plugin's own fiber (`src/index.ts:7-8,337-343`; `src/settings.ts:153-155`) and its queue/runtime teardown is a `ctx.effect` cleanup (`src/index.ts:337-343`). Source reading says one teardown + one re-registration per HMR stop/start; duplicate-listener behavior is a runtime verification item (§12).

---

## 2. Session-event surface

`@deepseek-ai/dsh-session` = `packages/core/session`. The plugin only reads the Cordis events `session/event` and `session/disposed` and interprets `SessionEvent` payloads structurally; it appends nothing.

### 2.1 `SessionEvent` envelope — CHANGE_CLASS: **same**

- OLD `packages/core/session/src/types.ts:493-517`; NEW `:494-517`. The mapped envelope is identical: `type`, `seq: SessionSeq`, `time`, `data: SessionEventMap[K]`, `ignorable?: true`, and the conditional `surfaceOp`/`sourceEventSeqs` intersection for `SurfaceEventType`.
- NEW-only additions after the envelope: `PluginRecordType`, `PluginRecordMap`, `PluginRecord` (`types.ts:519-550`), and `appendPluginRecord`/`pluginRecordOf` plus a `plugin:`-grammar commit path in `packages/core/session/src/index.ts` (NEW: record grammar `:434-441`; public API `:492-517`; private commit `:830-880`). Additive: a reader that does not recognize a `plugin:` event retains and skips it (`ignorable: true`). No existing decoder behavior changes.
- `SESSION_FORMAT_VERSION` stays `4` (OLD `types.ts:89`, NEW `:90`); only the policy comment changed (OLD `:71-88`, NEW `:72-89`). `SessionEventType` unchanged.
- `KNOWN_SESSION_EVENT_TYPES` adds `job/registered`, `job/settled` and `working-directory/change` at NEW (`known-event-types.ts:45-46,83`) — additive vocabulary.
- `packages/core/session/src/invariant.ts` (the optional `session-invariant` companion) is **deleted** at NEW (OLD file, 258 lines; absent from NEW tree). This is an absence of an optional companion, not a change to the event contract. The plugin never imports it.
- The plugin's declaration-merge import `import type {} from '@deepseek-ai/dsh-session'` (`src/index.ts:39`) is what types `ctx.on('session/event', …)`; that augmentation is `packages/core/session/src/index.ts` at OLD `:48-87` / NEW `:47-82` (`session/created` OLD `:55`/NEW `:54`, `session/disposed` OLD `:65`/NEW `:63`, `session/event` OLD `:77`/NEW `:74`, `session/flush` OLD `:86`/NEW `:82`). Signatures and dispatch modes are unchanged; only stale `@dshScopeScan unsupported` doc tags were removed at NEW (`index.ts` diff).

### 2.2 `turn/end` — CHANGE_CLASS: **same**

- OLD `types.ts:297` `'turn/end': { turn: number; reason: TurnEndReason }`; NEW `:298` identical.
- `TurnEndReasonMap` OLD `:201-233`, NEW `:202-233`: `completed`, `aborted` (`reason: TurnEndCancelCause`), `blocked`, `error` (`error: LlmFailure`), `max-tokens`, `interrupted`, `forked`; `TurnEndCancelCause`/`AgentCancelCause` unchanged (OLD `:190-197` / NEW `:191-197`). The plugin's classifier reads these seven kinds (`src/completion.ts:20` "seven confirmed turn/end reason kinds").

### 2.3 `assistant/message` (incl. token usage) — CHANGE_CLASS: **same**

- OLD `types.ts:341-350`; NEW `:342-351`: `{ turn, step, message: AssistantMessage, stream: AssistantStreamRecord[], usage?: TokenUsage, interrupted?: true }` — identical.
- `TokenUsage` OLD/NEW `packages/llm/llm/src/types.ts:175-190`: `inputTokens`, `outputTokens`, `totalTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?` — byte-identical at both tags (`git diff` for that file shows no change in this interface; the file's changes are `LlmConfigurableProvider.defaultBaseURL/baseURLEnv/nativeAuth` and comments at `:263-292`, `:396-400`, `:564-568`).
- `assistant/attempt` OLD `:355` / NEW `:356` unchanged; the plugin treats it as a recognized non-message event (`src/runtime-adapter.ts:276-282,341`).
- Host telemetry packages changed only in OTLP exporter typing/self-observability metrics at NEW (`packages/telemetry/otel/src/event-log.ts:31`, `event-transport.ts:13-18`, `transport.ts:9-40`, `session-log.ts:22-38` NEW); `TokenUsage`/event payloads are untouched. The plugin's "telemetry schema v2" is its own DTO version (`docs/DECISIONS.md` D017; `docs/ARCHITECTURE.md` §4.1 in the plugin repo), not a host schema.

### 2.4 `user/message` + `MessageSource.kind` — CHANGE_CLASS: **same**

- OLD `types.ts:309` / NEW `:310` `'user/message': UserMessage` — identical. The plugin resolves the message directly and reads `source.kind` (`src/runtime-adapter.ts:198-245`).
- Base `MessageSourceMap` OLD/NEW `packages/llm/llm/src/message.ts:110-111` includes `user: { kind: 'user' }`; `MessageSource` union at `:136`; the file is byte-identical at both tags (`git diff` empty).
- The only augmentation delta: `packages/api/session-controller/src/types.ts` `'user-rpc'` variant OLD `:403` `{ kind: 'user'; rpcId; clientTimeZone? }` vs NEW `:418` `{ kind: 'user'; rpcId; clientTimeZone?; principal?: Principal }` — optional additive field; `kind` unchanged.
- Late-reply source kind is declared by the questions package: `'user-question-reply': { kind: 'user-question-reply'; callId; outcome: 'answered' }` at `packages/interaction/user-questions/src/types.ts:107-119` (line 117), byte-identical at both tags.
- The plugin selects only `source.kind === 'user'` for direct human prompts and treats everything else as injected (`src/event-handler.ts:78,164,187,280-290`).

### 2.5 `tool/call` — CHANGE_CLASS: **same**

- OLD `types.ts:361-362`; NEW `:362-362`: `{ turn, step, callId: ToolCallId, name: string, arguments: string }` — identical, including raw unparsed `arguments`. The plugin reads this for `ask_user_question` detection and approval/attention tracking (`src/runtime-adapter.ts:388`, `src/event-handler.ts:660-669`).

### 2.6 `tool/result` — CHANGE_CLASS: **same**

- OLD `types.ts:375-386`; NEW `:376-387`: `{ turn, step, message: ToolResultMessage, error?: { name, code, reason? }, meta?: JsonValue }` — identical. `SurfaceEventType` OLD `:439-445` / NEW `:440-446` unchanged.

### 2.7 Approval audit events — CHANGE_CLASS: **same**

- `packages/interaction/user-approval/src/types.ts` is **byte-identical** between tags (`git diff --stat` for the package shows only `src/invariant.ts` deleted and `package.json`/locale changes):
  - `ApprovalRequestId` branded id `:17-26`; `ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'` `:32`;
  - `'approval/asked'` `:44-49` `{ id, toolName, callId?, reason? }`; `'approval/decided'` `:55-58` `{ id, outcome }`;
  - `ApprovalRequestEvent` `:63-76`; `'approval/request'` waterfall `:78-92`.
- Service flow identical: `packages/interaction/user-approval/src/index.ts:55` outcomes, `:150` class, `:215` `request()`, `:225` appends `approval/asked`, `:231-232` decides then appends `approval/decided`; `APPROVAL_POLICIES` `:70`.
- Removed at NEW: only the optional `./invariant` companion export and `src/invariant.ts` (package.json `./invariant` export removed; `lib/invariant.js` removed from files). No contract element used by the plugin changed.
- The plugin deliberately listens only for `approval/asked` audit events, not the `approval/request` waterfall (`src/index.ts:454-466`; `src/runtime-adapter.ts:502`). That remains valid.

### 2.8 timed `ask_user_question` (timeout non-error + late reply) — CHANGE_CLASS: **same**

Both `packages/interaction/tool-ask-user/src` and `packages/interaction/user-questions/src` are **byte-identical** between the tags (`git diff --stat` empty for both directories); only `package.json` versions/locale/dependency pins changed. Therefore the whole timed-question contract below is unchanged (line numbers valid at both tags):

- Tool: `registerTimedAskUser` (`tool-ask-user/src/timed.ts:103-208`); opt-in behind config mode `'legacy' | 'timed'` (default `legacy`) in `packages/interaction/tool-ask-user/src/index.ts:18,24,34-35`; the timed tool is still named `ask_user_question` (`timed.ts:107`).
- Timeout validation `-1` or positive integer seconds up to 2147483 (`timed.ts:12-17`; service-side ms ceiling `user-questions/src/index.ts:239-241`).
- Timeout deadline parameter is `timeout` (`TIMED_WAIT_PARAMETER = 'timeout'`, `user-questions/src/projection.ts:36`); a timed tool schema is recognized by that parameter (`projection.ts:124-129`).
- On expiry the tool result is a **non-error pending result** `{ pending: true, callId }` with a model-facing `message` (`user-questions/src/index.ts:43, 260-263`; `tool-ask-user/src/timed.ts:39-42,191-199`). The question remains answerable; the foreground wait is `TimedQuestionWait` with a Host-clock deadline and claim counting (`user-questions/src/timed-wait.ts:4-83`, schedule `:33-38`, close `:75-82`), and settlement happens through the answerer waterfall (`user-questions/src/index.ts:234-269`).
- Late reply: a new `user/message` whose `source.kind === 'user-question-reply'` carries `{ callId, outcome: 'answered' }` (`types.ts:107-119`; service consumption `index.ts:95-122`); the `userQuestions` projection records active/settled calls (`types.ts:71-105`), so a late reply settles the timed call even though its own tool result recorded the timeout (`types.ts:82-93`).
- The plugin's notification path observes the `tool/call` for `ask_user_question` (`src/event-handler.ts:660-669`, `src/human-attention.ts:33,172`) and never depends on the timeout/reply mechanics. Unchanged.

### 2.9 `SessionHeader` / session source classification — CHANGE_CLASS: **same**

- `packages/core/session/src/types.ts` `SessionHeader`: OLD `:94-131`, NEW `:95-132` (one-line shift from the format-version comment rewrite). Fields identical: `version: 4`, `id`, `createdAt`, `cwd?`, `parentSession?` (fork lineage), `isSeeded`, `origin?: 'subagent'` (OLD `:117`, NEW `:118`), `delegationDepth?` (OLD `:123`, NEW `:124`), `agentPreset?` (OLD `:130`, NEW `:131`).
- Writers/validators unchanged: `Session` header construction OLD `packages/core/session/src/index.ts:1049-1060` / NEW `:1174-1191`; `delegationDepth` validation OLD `:131-133` / NEW `:127-129`.
- The plugin's subagent classification reads exactly `origin === 'subagent'` then strictly positive finite `delegationDepth` (`src/runtime-adapter.ts:88-155`, decision at `:141-152`). Both fields and their documented meanings are unchanged; `Session` exposes `header` (OLD `index.ts:464`, NEW `:540`) as the storage metadata it reads.
- Wire summary (`SessionSummary.delegationDepth`) changed line only (`packages/api/session-controller/src/types.ts:441` OLD → `:459` NEW); the plugin does not consume it.

### 2.10 Token usage / "telemetry schema v2" — CHANGE_CLASS: **same**

- Host accounting surface is `assistant/message.data.usage?: TokenUsage` (2.3) — unchanged; the plugin folds per-call usage into its own schema-v2 DTO (`src/telemetry.ts`, `tests/integration/turn-telemetry.test.ts`) and consumes no host telemetry package. Host OTel changes at NEW are exporter-internal (2.3) and unrelated.
- `packages/session/session-stats/src` (host token/stats projection) is **unchanged** between tags (`git diff --stat` empty), and the plugin does not import it.

---

## 3. Credential provider API (`@deepseek-ai/dsh-credentials`)

### 3.1 OLD_CONTRACT (tag `dsh-v0.2.0-rc.2`)

- Abstract service `CredentialProvider` in `packages/credentials/credentials/src/index.ts:170-209`: `resolve(ref): Promise<ResolvedCredential | undefined>` (`:183`), `describe(ref): Promise<CredentialInfo>` (`:191`), `set(ref, value)` (`:201`), `unset(ref)` (`:209`), plus record-key space methods (unchanged). `CredentialInfo` in `packages/credentials/credentials/src/types.ts:67-73` (`configured`, `source?`, `writable`).
- `credentials/reference-updated` / `credentials/record-updated` events, contained fan-out with an `INVARIANT`-code rethrow exception (`index.ts:259-300`).
- Provider implementation `packages/credentials/credentials-local/src/index.ts`: read priority documented at `:1-26` — **inherited process environment wins**, then `$DSH_HOME/.credentials.yaml`, then `<cwd>/.env`, then `$DSH_HOME/.env`. `resolve()` returns the env value first (`:609-618`). `describe()` reports env-sourced refs `{ configured: true, source: 'env', writable: false }` (`:619-628`). `set`/`unset` reject a write when an inherited env var shadows the ref, via `assertUnshadowed` (`:633-646` call sites `:744,750`; implementation `:780-791`); unknown top-level YAML keys are a hard parse error (`:218-223`).

### 3.2 NEW_CONTRACT (tag `dsh-v0.2.1-rc.2`)

- Public signatures **unchanged**: `packages/credentials/credentials/src/index.ts:171-209` (same four abstract methods, same parameter/return types); `CredentialInfo` unchanged at `credentials/src/types.ts:67-73`. Event names unchanged; `INVARIANT` rethrow exception removed from the fan-out (`index.ts:259-300` → NEW `:256-297`) and from the service docs, but that is internal error plumbing, not an API change.
- Provider implementation `credentials-local/src/index.ts`: precedence **inverted** — managed store wins, then inherited env, then dotenv fallbacks (`:1-27`; header table `:6-10`). `resolve()` checks `this.values` first (`:624-633`); `describe()` reports stored `writable: true` first and now also env-sourced refs `writable: true` (`:634-643`); `assertUnshadowed` is gone, so `set`/`unset` no longer refuse env-shadowed references (`:645-659`). Unknown top-level document keys are kept and only warned about (`:176,184,211,228,797,872,883-888`); unversioned root and malformed internals still throw.
- The remote façade the plugin's browser half uses (`remote.credentials.describe/set/unset` via `@deepseek-ai/dsh-api-settings-controller`) only had comment changes: `packages/api/settings-controller/src/credentials.ts:132-137` and `types.ts:20-30` reword the `credential/rejected` documentation (a provider refusal, e.g. unparsable stored document, is what a settings page shows); method surface unchanged; no source change in the resolved method signatures.
- **Runtime confirmation (R1, 2026-10-17):** the installed `0.2.1-rc.2` provider was driven in an isolated child process with a synthetic value A in the managed file and a *different* synthetic value B in the inherited environment. `resolve()` returned A with `source: file`; after `unset(A)` it returned B with `source: env`; after `set(C)` it returned C with `source: file`. `describe()` reported `configured: true`, `writable: true` and the expected `source` in each phase. This confirms the NEW order above as behavior, not merely as source. Evidence and the separate PASS records: `V0.5.1_COMPAT_R1_REPORT.md`.

### 3.3 Semantic change note / CHANGE_CLASS

CHANGE_CLASS: **compatible** (public API), with an observable behavior change:
1. Effective value for a name present in both the managed store and the process env flips from env → store. A plugin that resolves one named ref (the plugin does: `src/credentials.ts:36-39,90-103,116-154`; invoked per send through `credentialProviderResolver` `src/index.ts:398`) may now get a different secret than on the OLD host, without any type/code break.
2. `describe().writable` is now true for env-sourced refs; the plugin's card renders the secret field disabled when `!writable` (`src/client/controller.ts:511-526`, `src/client/Card.tsx:371,378`), so a previously read-only field becomes editable.
3. Writes that OLD rejected ("supplied read-only by the launching environment") now succeed.
4. A foreign top-level key in `.credentials.yaml` no longer prevents boot.
No plugin code change is required for the plugin to keep working; R1 corrected the plugin's credential-precedence/read-only environment documentation and added a conflict test that distinguishes precedence, fallback and rotation (`V0.5.1_COMPAT_R1_REPORT.md`).

---

## 4. Volatile configuration and `loader/volatile-update` (vendored Loader)

- The Loader is vendored: `vendor/loader` (package `@deepseek-ai/cordis-plugin-loader`, shipped inside the DSH installation and **not published to npm**; the plugin restates the event signature for this reason — `src/settings.ts:44-60`).
- Event declaration unchanged: `vendor/loader/src/index.ts:34` `'loader/volatile-update'(paths: readonly (readonly string[])[]): void` at **both tags**. `vendor/loader/src/index.ts` is byte-identical at both tags; the only `vendor/loader/src` delta between tags is `config/entry.ts` (+9/−5), which adds `Entry.moduleNamespace` (raw import result, HMR namespace tracking) at `:45-49` NEW and sets it after a successful import at `:221-235` NEW — no change to the volatile-conflict/commit path.
- Emission/commit machinery unchanged semantically: `vendor/loader/src/config/entry.ts` — volatile-only update detection `:143-150` OLD / `:145-152` NEW; `_commitVolatile` parses through the fiber's `internal/config` hook, commits into running references, emits to the owning fiber with changed paths `:189` OLD / `:191` NEW; a throwing listener is logged and does not fail the update (`README` in both tags). Schema marker `schema.meta.volatile` in `config/diff.ts:18` (unchanged).
- Supporting versions changed only as version numbers: `@deepseek-ai/cordis` 4.0.4 → 4.0.5 (source identical; `git diff --stat` for `vendor/cordis/src` empty), `@deepseek-ai/schemastery` 3.18.4 → 3.18.5 (source identical), `@deepseek-ai/cosmokit` 1.8.5 → 1.8.6 (`vendor/cosmokit/src/volatile.ts` byte-identical; `git diff --stat` for `vendor/cosmokit/src` empty). The plugin's peers `@deepseek-ai/cordis ^4.0.4` and `@deepseek-ai/schemastery ^3.18.4` remain satisfied by 4.0.5 / 3.18.5.
- Plugin side unchanged and still valid: `ctx.on('loader/volatile-update', …)` on the plugin fiber (`src/settings.ts:61-69,133-167`, listener at `:153-155`), re-reading the whole snapshot and rebuilding the runtime; fiber teardown removes the listener (`src/index.ts:337-343`).
- CHANGE_CLASS: **same**.

---

## 5. `configForms` (`@deepseek-ai/dsh-client-ui-settings`, client face)

### 5.1 OLD_CONTRACT

- `ConfigFormSnapshot<T>` (`packages/client/ui-settings/src/client/config-form-types.ts:8-34` OLD) fields: `status: 'loading'|'ready'|'unavailable'`, `value`, `base`, `user`, `revision`, `writable`, **`mode: 'host' | 'memory'`** (`:33`). `status` could be `unavailable` for non-loopback pages in memory mode (`:9-13`).
- `ConfigForm<T>` (`:39-77`): `getSnapshot`, `subscribe`, `mutate(ops, expectedRevision?)`, `set(field, value)`, `unset(field)`.
- Service `ConfigForms` in `packages/client/ui-settings/src/client/config-form.ts:241` with `get<T>(entryId)` at `:293` and `whileServed(namespaces, register)` at `:317`; provider geometry passed a `persistence: 'host' | 'memory'` chosen from `ctx.remote.$host.isLoopback` (`packages/client/ui-settings/src/client/index.ts:38-40,53` OLD); `ConfigFormController` accepted it (`config-form.ts:52-…` OLD).

### 5.2 NEW_CONTRACT

- `ConfigFormSnapshot<T>` (`config-form-types.ts:8-31` NEW): same fields **minus `mode`**; `writable` doc no longer mentions memory mode; `status` no longer has the memory-mode `unavailable` cause.
- `ConfigForm<T>` unchanged (`:36-74` NEW): identical method set/parameters/returns.
- Service `ConfigForms` (`config-form.ts:236` NEW), `get` (`:284`), `whileServed` (`:308`) — same signatures. `persistence` removed; every authenticated browser persists through the Host document (`ui-settings/src/client/index.ts:38,53` NEW); `ConfigFormController` no longer has the memory path (`config-form.ts` NEW).
- `packages/client/ui-settings/package.json:4` is `0.2.0-rc.2` OLD / `0.2.1-rc.2` NEW; the `./client` subpath export is present at both.
- Plugin usage compiles against the unchanged parts: `this.form = ctx.configForms.get<Section>(...)` (`src/client/controller.ts:175-178`), snapshot read (`:475`), `status`/`writable` (`:511-512`), registration inside `ctx.configForms.whileServed` (`src/client/index.tsx:21,75-79`). The plugin never reads `.mode` (repo grep: no `mode` use in `src/client`).

### 5.3 CHANGE_CLASS / advisory

CHANGE_CLASS: **compatible**. The removed `mode` field is a type-level breaking change only for consumers that call it; the plugin does not. Behavioral change: on remote (non-loopback) Web pages the plugin's configuration form is now writable and Host-persisted instead of browser-local/disabled. Advisory: do not reintroduce `.mode`-dependent UI logic; `status === 'unavailable'` now means only "namespace not exposed to this client".

---

## 6. `plugins.bundle.config` slot (`@deepseek-ai/dsh-client-ui-plugin-manager`)

- Declared at both tags as a keyed root slot whose owner props are `PluginConfigViewProps`:
  - OLD `packages/client/ui-plugin-manager/src/client/slot-contract.ts:94` (`'plugins.bundle.config': { kind: 'keyed'; scope: 'root'; owner: PluginConfigViewProps }`); `PluginConfigViewProps` at `:23-29` (`view: 'summary'|'page'`, `form?: ConfigPageForm`).
  - NEW `slot-contract.ts:142` same declaration; `PluginConfigViewProps` at `:26-32` identical content (only unrelated new slots `plugins.add.actions` / `plugins.tab` and interface additions were inserted above).
- Registered by the page with `children: {'plugins.bundle.config': {kind:'keyed', scope:'root'}, …}`: OLD `client/index.ts:118-…`, NEW `:120-…` (same child table plus the new slots).
- README description (both): `packages/client/ui-plugin-manager/README.md:112` OLD / `:133` NEW — "`plugins.bundle.config` supplies bundle detail configuration, keyed by npm package name…".
- Plugin side: `src/client/contracts.ts:60,114-149` (slot constant and `PluginConfigViewProps` alias), `src/client/index.tsx:76-79` registers its card. Exports unchanged: `PluginConfigViewProps` is re-exported by the package's `./client` entry at both tags (`client/index.ts` export list; OLD `:49-52`, NEW `:52-56`).
- Related but not used by the plugin: `PluginPackageRef` gains required `availability` and `official` fields at NEW (`slot-contract.ts:44-…` NEW vs `:41-…` OLD) — a type-level break only for code that *constructs* the ref; the plugin only receives view props.
- CHANGE_CLASS: **same** for the slot contract the plugin uses.

---

## 7. `connection.fetch.register` (`@deepseek-ai/dsh-client-connection`)

### 7.1 OLD_CONTRACT

- Host handle `HostConnectionHandle` in `packages/client/connection/src/rpc.ts:193-…` (OLD); exact-route registry `HostConnectionFetch.register(route): () => Promise<void>` at `:162`; route shape `ConnectionFetchRoute` at `:144-157`: `{ path, methods: readonly ConnectionFetchMethod[], requestBody: 'buffered'|'streaming', fetch: (request: Request) => Promise<Response> }` (`fetch` at `:152`); `HostConnectionHandle.operator: PeerScope` at `:199`; per-request admission through `admit()` (`:218-220`).
- The host `ctx.connection` service is assembled in `packages/client/connection/src/index.ts` (Cordis plugin `client-connection`), with the `/api` route and bridge.

### 7.2 NEW_CONTRACT

- `HostConnectionHandle` NEW `rpc.ts:206-…`; registry `host.fetch.register` NEW `:175`; `ConnectionFetchRoute` NEW `:153-166` with the **same** four fields and single-arg `fetch` (`:165`). So the API the plugin calls is unchanged: plugin code `connectionCtx.connection.fetch.register({ path, methods: ['POST'], requestBody: 'buffered', fetch: handler })` (`src/index.ts:318-335`) type-checks and behaves the same.
- Host-side deltas (do not change the plugin's route registration):
  - `operator: PeerScope` removed → `browserPeer: PeerScope` (NEW `:212`); new `createPeer(options)` and `admitConnection(request)` (`rpc.ts` NEW; `peer.ts` new file replaces `operator-peer.ts`), new `allowsRemoteAuthorities`.
  - `HostConnectionFetch.register` now dispatches exact routes only for owner Peers; the shared handler answers 403 for every other principal (`ConnectionFetchRoute.fetch` doc, NEW `rpc.ts:153-166` note "Only owner Peers reach an exact route").
  - `ConnectionFetchHandler.fetch(request, peer)` gained a required `peer` argument (`rpc.ts:285-292` NEW) and `http-bridge.ts:31-34` passes `admission.peer` — host-internal; the plugin never implements `ConnectionFetchHandler`.
  - New `/connect` route and v2 API cookie (`browser-auth.ts` NEW; `connect-protocol.ts` new) — unrelated to the plugin.
- CHANGE_CLASS: **compatible**. Advisory: if any automation calls the plugin's two exact routes without a browser owner cookie/Peer it will now get 403; the Web UI card and CLI-driven Web calls are the owner Peer.

---

## 8. `connection.rpc.call` (`@deepseek-ai/dsh-client-connection`)

- Client caller source is **byte-identical** between tags: `packages/client/connection/src/client/rpc.ts:29-46` (call implementation at `:37`); interface `ClientConnectionRpc` in `rpc.ts` OLD `:258-…` / NEW `:295-…` with `call(channel, endpoint, payload?, signal?)` (OLD `:267`, NEW `:304`). The plugin calls it as `ctx.connection.rpc.call(RPC_CHANNEL, endpoint, {}, signal)` (`src/client/wire.ts:151`) inside a host route context (`src/rpc.tsx`-free; `src/protocol.ts` host comment).
- Server side for the plugin's channel: plugin registers exact Fetch routes on `/api` (section 7) and decodes its own envelope (`src/web-rpc.ts`, `src/client/wire.ts`); that envelope never travels through the Typert gateway. The only gateway-relevant delta is the forwarded-event `resources` addition (below), which does not affect `rpc.call`.
- `packages/api/remotes` changes: `client/index.ts` re-export list adds plugin-market types (OLD `:139-146` / NEW `:142-155`); `remote-events.ts` adds per-event `resources` readers to `api-session/*` notifications (OLD entries `:20-42` plain `{event, mode}` / NEW `:26-51`, e.g. `:30`) and a new `plugin-market/changed` forwarded event; the plugin's `remote.credentials` / `remote.$on('credentials/reference-updated')` usage (`src/client/wire.ts:191-246`) is unaffected. `SettingsPathOpView` still exported at `packages/api/remotes/src/client/index.ts:142` OLD / `:149` NEW.
- CHANGE_CLASS: **same** (client call surface).

---

## 9. Client packages the plugin's browser half injects

The plugin declares `dsh.client.inject` (`package.json:26-31`): `@deepseek-ai/dsh-client-ui-renderer`, `dsh-client-ui-settings`, `dsh-client-ui-plugin-manager`, `dsh-client-connection`, `dsh-api-remotes`, `dsh-client-locale`; plus type imports of `dsh-client-ui-slots`, `dsh-api-settings-controller/remote`.

| Package | Source delta between tags | Subpath/export status | Class for plugin |
|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-slots` | exists at both tags; `src/index.ts` adds `inline?: true` (`SlotEntryDef`/`SlotSpec`); `renderer.ts` keyed-hook resolver gains optional `member` arg. Additive. | package version `0.2.0-rc.2` → `0.2.1-rc.2`; exports unchanged (`.` only; no `./client` subpath at either tag — it was never a client-entry package). | compatible (source). Installed-tree presence unverified (§12). |
| `@deepseek-ai/dsh-client-ui-settings` | `ConfigFormSnapshot.mode` removed, memory mode removed (section 5). | `./client` present at both; version bump only in `package.json:4`. | compatible |
| `@deepseek-ai/dsh-client-ui-plugin-manager` | slot-contract additions (`plugins.tab`, `plugins.add.actions`, `PluginPackageRef.availability/official`); page/store changes; `PluginConfigViewProps` and `plugins.bundle.config` unchanged. | `./client` present at both; `PluginConfigViewProps` still exported. | same for used surface |
| `@deepseek-ai/dsh-client-connection` | host peer/cookie/connect rework; client `./client` export map becomes `node`/`browser` conditional to `lib/client.node.js`/`lib/client.browser.js`; `ConnectionHandle` gains `interactions`/`openWebSocket`; `Peer` replaces `OperatorPeer` (host export). `rpc`/`isLoopback`/`state` unchanged. | `./client` present at both (now conditional); `./src/*` still exported. | compatible |
| `@deepseek-ai/dsh-api-remotes` | additive: plugin-market namespace/types, forwarded-event `resources`, Session resource registration; `SettingsPathOpView`/`CredentialInfo` re-exports unchanged. | `./client` present at both. | compatible |
| `@deepseek-ai/dsh-client-locale` | `src` unchanged (`git diff --stat` empty); version `0.2.0-rc.2` → `0.2.1-rc.2`. | `./client` present at both. | same |
| `@deepseek-ai/dsh-api-settings-controller` | `src/types.ts`, `src/credentials.ts` comment-only changes (section 3.2). | `./remote` present at both. | same |
| `@deepseek-ai/dsh-client-ui-renderer` | internal renderer changes (`bind.ts`, `bindings.tsx`, `scoped-slots.tsx`), `invariant.ts` removed; no plugin-facing export changes found in the diff. | `./client` present at both. | compatible |

Also: `@deepseek-ai/cordis` 4.0.4 → 4.0.5 with **identical source** (`git diff --stat` for `vendor/cordis/src` empty), so the plugin's peer `^4.0.4` is satisfied and no Cordis API break exists between tags. `@deepseek-ai/schemastery` 3.18.4 → 3.18.5 with identical source; peer `^3.18.4` satisfied.

---

## 10. Plugin `package.json` metadata: declarations and their exact gate consequences

Values read from the plugin working tree at audit time (Lead's uncommitted 0.5.1 bump; baseline released 0.5.0 in parentheses where relevant):

| Declaration | Current (0.5.1 tree) | Gate meaning at NEW `0.2.1-rc.2` |
|---|---|---|
| `version` | `0.5.1` (`package.json:3`) | n/a |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` (`:42`) | not read by the dsh gate |
| `engines.dsh` | `"0.2.1-rc.2"` (`:43`) | **decides alone**: `semver.satisfies('0.2.1-rc.2','0.2.1-rc.2',{includePrerelease:true})` = true → admitted; all dsh peers ignored |
| `@deepseek-ai/dsh` peer | `"0.2.1-rc.2"` (`:80`) | ignored while `engines.dsh` is present |
| `@deepseek-ai/dsh-credentials` peer | `"0.2.1-rc.2"` (`:81`) | ignored while `engines.dsh` is present; would pass the NEW runtime anyway |
| `@deepseek-ai/dsh-session` peer | `"0.2.1-rc.2"` (`:82`) | same |
| other dsh peers (`@deepseek-ai/cordis`, `schemastery`, `react`) | non-`dsh` names | never gated by this check |
| devDependencies `@deepseek-ai/dsh-*` | all `0.2.1-rc.2` (`:95-111`), `@deepseek-ai/cordis` 4.0.5 (`:95`), `schemastery` 3.18.5 (`:111`) | development-only; not read by the gate |
| `@deepseek-ai/cordis` peer | `^4.0.4` (`:79`) | host ships 4.0.5 → satisfied; not gated by name anyway |

**Baseline 0.5.0 metadata (the released state this audit was asked to judge):** no `engines.dsh`; peers `@deepseek-ai/dsh-credentials: 0.2.0-rc.2`, `@deepseek-ai/dsh-session: 0.2.0-rc.2`; no `@deepseek-ai/dsh` peer; devDeps 0.2.0-rc.2. On the NEW host this fails exactly as follows:

```
pluginCompatibilityWarning ->
Plugin dsh-mail-notify@0.5.0 is incompatible with dsh 0.2.1-rc.2: requirements
{"@deepseek-ai/dsh-credentials":"0.2.0-rc.2","@deepseek-ai/dsh-session":"0.2.0-rc.2"}.
Running it may cause crashes or data loss. Update the plugin or install a plugin version
compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version
exemption for dsh-mail-notify@0.5.0 on dsh 0.2.1-rc.2 with `dsh plugin allow-version` or the
plugin manager, then retry the installation or restart dsh. Exact-version exemption: not active.
```

and the effective consequences are: install preflight rejects (`exit 1`, nothing installed, CLI prints the `allow-version` command); if already installed, profile startup skips the incompatible bundle (`skippedBundles`, stderr) so its rows never load — or disables an incompatible non-bundle row. The exemption workaround for the exact pair:

```
dsh plugin --profile <profile> allow-version dsh-mail-notify@0.5.0 --dsh-version 0.2.1-rc.2 --accept-risk
```

records `compatibility.json: {"dsh-mail-notify@0.5.0":["0.2.1-rc.2"]}`, after which the same gate returns `exempted: true` and admission proceeds.

**Required metadata changes (release decision):**

1. **Minimum, preferred:** declare `engines.dsh` with a range that includes the target runtime(s), e.g. `"0.2.1-rc.2"` (0.5.1 bump already does this) or `">=0.2.0-rc.2 <0.3.0"` if both rc.2 hosts must be supported. An own `engines.dsh` makes all dsh peers gate-irrelevant.
2. **Alternative, if `engines.dsh` is not added:** every `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer must match the runtime, so `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-session` must move from exact `0.2.0-rc.2` to a range covering the runtime (e.g. `0.2.1-rc.2` or `^0.2.1-rc.2` …). Note the NEW gate now also reads a recommended `@deepseek-ai/dsh` peer if present; it is not required, but adding it does not create an exemption from the other peers.
3. Do not put `workspace:` syntax in `engines.dsh` (always unmet); `workspace:^|~|*` remains valid only for peers.
4. Keep `engines` an object and `engines.dsh` a string; a non-object `engines` throws (manifest malformed) and is refused by the preflight catch.
5. Metadata-only change: the gate runs before import, so no code change is implied by the gate itself. The 0.5.1 bump also moves the devDependencies to the host's installed versions (0.2.1-rc.2, cordis 4.0.5, schemastery 3.18.5) — correct for compile probes, and gate-irrelevant.

---

## 11. Cross-cutting findings that matter for the verdict

1. The gate change is a **metadata contract change**, not an API break: every runtime surface the plugin actually calls is source-identical or additively compatible. The sole release-blocking item is the plugin's own declared requirements, and the 0.5.1 bump addresses it (assuming the released artifact carries the bumped manifest and the host's runtime version is exactly `0.2.1-rc.2`).
2. The plugin's host-side code uses only `ctx.on('session/event'|'session/disposed')`, `ctx.get('credentials')`, `ctx.on('loader/volatile-update')`, `ctx.inject(['connection'])` + `connection.fetch.register`, and its own routes — all preserved. No host export it imports was removed or re-signed between tags (only host-internal exports such as `OperatorPeer`, `HostConnectionHandle.operator` and `ConnectionFetchHandler.fetch` changed).
3. The plugin's browser half imports `ConfigForm`/`ConfigFormSnapshot` from `@deepseek-ai/dsh-client-ui-settings/client` (section 5) and `PluginConfigViewProps` from `@deepseek-ai/dsh-client-ui-plugin-manager/client` (section 6); both remain exported and the used fields remain. The one removed field (`ConfigFormSnapshot.mode`) is not read by the plugin.
4. `@deepseek-ai/dsh-client-ui-slots` still exists in the NEW source tree as `packages/client/ui-slots` (version `0.2.1-rc.2`), still the slot registry package; no merge/rename is visible in source. The Lead's observation that it is not installed in the 0.2.1 host tree is a packaging fact outside the source tree; see §12.

---

## 12. Cannot be established from source alone (requires runtime verification)

1. **Installed host's runtime version string.** `getDshRuntimeVersion()` reads the packaged `@deepseek-ai/dsh-app-boot/package.json`; packaging may rewrite manifests/version spellings (e.g. build metadata). Verify on the actual 0.2.1-rc.2 installation that `dsh --version` reports exactly `0.2.1-rc.2` and that the exact `engines.dsh: "0.2.1-rc.2"` passes.
2. **Presence of `@deepseek-ai/dsh-client-ui-slots` (and other client packages) in the installed host tree.** Source still contains the package, but whether the shipped asar/installation includes it (the Lead reports it is not installed) determines whether the plugin's client injection can be satisfied. Inspect the installed `node_modules`/`app.asar`/`resources` tree.
3. **pnpm peer resolution during installation.** The gate is evaluated first, but `pnpm add` also resolves the plugin's declared peers; auto-install-peers/strict-peer-dependencies settings live in the profile's pnpm configuration, not the DSH source tree. Verify `dsh plugin add`/install output for peer warnings or duplicate copies of `@deepseek-ai/dsh-session`/`dsh-credentials`.
4. **Whether the target profile runs with HMR enabled.** Install/upgrade/`restartReason` behavior depends on the profile composition (HMR entry present). Source shows both paths; the actual profile YAML is deployment data.
5. **HMR stop/start behavior on the target OS (Windows).** Source-level intent is one fiber teardown + one re-apply; verify no duplicated `session/event` listeners, duplicated mail sends, or retained queue/timer after an install/update on the real host (plugin logs and a probe session).
6. **Event ordering guarantees the plugin relies on** (e.g., `user/message` before/inside its turn; `turn/end` finality; `assistant/message.usage` presence when an adapter reports usage). Documented in source (`types.ts` comments) but only runtime logs prove adapter behavior; the plugin's telemetry completeness flags depend on this.
7. **Approval/late-answer behaviour in the composed UI.** `approval/asked`/`approval/decided` and `user-question-reply` contracts are source-stable, but which answerer plugins the deployment mounts (and their timeout/cancel paths) determines observed behavior; verify with the plugin's `probe:approvals*`/`probe:timed-questions` probes.
8. **Credential precedence in the target deployment.** NEW store-wins semantics depend on the mounted provider (`credentials-local`) and where the value lives; verify the SMTP password resolves from the expected layer in the real profile.
9. **Effective slot availability.** `plugins.bundle.config` exists in source; whether the installed `dsh-client-ui-plugin-manager` build exposes it at runtime (and whether the plugin's card injects `configForms`/`connection`/`remote` in the assembled client) requires loading the Web UI on the 0.2.1 host.
10. **`remote.credentials` namespace behaviour on the 0.2.1 assembly.** Source shows the façade unchanged, but the client assembly's mounted namespaces depend on the shipped API remotes build; verify `describe/set/unset` from the card in the Web UI.
11. **HMR pending/restart reasons actually emitted for this package** (`module-comparison`, `package-moved`, `host-module`) when installed/updated on the real host, including whether `installBundle` reports `already-installed` for the upgrade path the release notes describe.
12. **Absence of an HMR disposal edge case**: whether a stopped plugin's in-flight mail queue drains or is cancelled on a live update — source says the fiber teardown runs and the plugin's teardown releases the runtime, but durable/lossy behavior of queued mail during HMR replacement is runtime-observable only.

---

## Appendix A — Surface enumeration method

For each required surface, the repo tree was enumerated at both tags and the files diffed, so "same" means byte-identical source (or only comment/whitespace deltas in unrelated hunks), not merely "not obviously changed":

- Session events: `git diff dsh-v0.2.0-rc.2 dsh-v0.2.1-rc.2 -- packages/core/session/src` (changed files: `index.ts`, `invariant.ts` deleted, `known-event-types.ts`, `surface.ts`, `types.ts`; event payload regions unchanged); `packages/interaction/user-approval/src`, `packages/interaction/user-questions/src`, `packages/interaction/tool-ask-user/src` (last two empty diffs); `packages/llm/llm/src/types.ts`/`message.ts`; `packages/session/session-stats/src` (empty); `packages/session/session-telemetry/src`; `packages/telemetry/otel/src`.
- Credentials: `packages/credentials/credentials/src`, `packages/credentials/credentials-local/src`.
- Config/hot reload: `vendor/loader/src` (only `config/entry.ts` changed: `moduleNamespace` field), `vendor/cordis/src` (empty diff), `vendor/cosmokit/src` (empty diff), `vendor/schemastery/src` (empty diff), `packages/boot/hmr/src`, `packages/boot/app-boot/src`.
- Gate: `packages/boot/app-boot/src/{plugin-compatibility,compatibility-preflight,profile,profile-compatibility,package-meta}.ts`, `packages/boot/plugin-manager/src`, `apps/cli/src/{plugin,bin}.ts`, `packages/boot/plugin-market` (NEW).
- Client contracts: `packages/client/{ui-settings,ui-plugin-manager,connection,ui-slots,locale,ui-renderer}/src`, `packages/api/remotes/src`, `packages/api/settings-controller/src`.
- Plugin repo usage (read-only): `src/index.ts`, `src/settings.ts`, `src/credentials.ts`, `src/runtime-adapter.ts`, `src/event-handler.ts`, `src/client/*`, `tests/compatibility/contracts.compile.ts` paths.

## Appendix B — Host package versions at the two tags (gate-relevant)

| Package | OLD `dsh-v0.2.0-rc.2` | NEW `dsh-v0.2.1-rc.2` |
|---|---|---|
| `@deepseek-ai/dsh` (`apps/cli`) | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/dsh-app-boot` (runtime-version source) | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/cordis` (vendored) | 4.0.4 | 4.0.5 (source identical) |
| `@deepseek-ai/schemastery` | 3.18.4 | 3.18.5 (source identical) |
| `@deepseek-ai/cosmokit` | 1.8.5 | 1.8.6 (`volatile.ts` identical) |
| `@deepseek-ai/dsh-hmr` | 0.2.0-rc.2 | 0.2.1-rc.2 (rewritten) |
| `@deepseek-ai/dsh-plugin-manager` | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/dsh-client-ui-slots` | 0.2.0-rc.2 | 0.2.1-rc.2 (source present) |
| `@deepseek-ai/dsh-client-ui-settings` | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/dsh-client-connection` | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/dsh-credentials` / `-local` | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/dsh-session` | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/dsh-api-remotes` | 0.2.0-rc.2 | 0.2.1-rc.2 |
| `@deepseek-ai/dsh-plugin-market` | absent | 0.2.1-rc.2 (new) |

---

## Appendix C — Lead reconciliation: the FINAL v0.5.1 declaration

This report was produced while the release declaration was still being decided. Its §10 advisory
metadata ledger records a then-proposed root `@deepseek-ai/dsh` peer. The **final** `package.json`
does not include that peer, and this appendix is the authoritative reconciliation; nothing in the
contract analysis above changes.

Final declaration:

- `engines.dsh: "0.2.1-rc.2"`, exactly. Per the NEW gate
  (`packages/boot/app-boot/src/plugin-compatibility.ts:55-61`), an own `engines.dsh` decides alone;
  the DSH-peer check at `:62-73` is the fallback consulted only when no `engines.dsh` is declared.
- `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-session` peers are exact `0.2.1-rc.2`. They
  name the service instance the plugin resolves through and the declarations it type-imports; with
  `engines.dsh` present the gate does not read them, so they are an instance declaration rather than
  a second compatibility range.
- **No `@deepseek-ai/dsh` peer is declared**, for three evidenced reasons: (1) the NEW tag's own
  plugin-authoring guide, `docs/user/develop/basic/publish.md`, designates `engines.dsh` as the
  host-range declaration and names DSH peer ranges as its fallback only; (2) the plugin imports no
  host package (see `docs/compat/02_PLUGIN_USAGE_AUDIT.md` §1); (3) npm/pnpm install a root host
  peer, so declaring it pulls the whole DSH application into a consumer's production dependency
  tree — in this repository's dev tree it changed the install from 700 to 163 packages and
  `npm audit --omit=dev` from 8 moderate host-tooling advisories to 0.
- No dual range is claimed. `engines.dsh` is exact, so `0.2.1-rc.2` accepts and any other runtime
  refuses. Separately, a `0.2.0-rc.2` host reads no engines rule and applies the peer fallback,
  which mismatches the 0.2.1 peers — so `0.5.1` is not installable there by its own declaration,
  and the published `0.5.0` remains the `0.2.0-rc.2` line.

