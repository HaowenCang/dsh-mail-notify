# RELEASE — building, packing, installing, updating, rolling back

Everything below has been executed on this machine. Where a command's output matters for trust,
the expected result is stated next to it.

## 1. Prerequisites

| Requirement | Value used |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` (`v24.13.0` used) |
| npm | `11.12.0` used |
| DSH | `0.1.5-rc.1` installed and on `PATH` as `dsh` |
| Runtime dependency | `nodemailer@10.0.9` (declared `^10.0.9`; the only runtime dependency) |
| Peer packages resolvable from the profile | `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-credentials` |

Nodemailer's own security policy supports only its current major, so the declared range stays on
`10.x`: `^10.0.9` cannot reach `11` unattended, and its lower bound is the patched line rather than
`10.0.0`. Nodemailer 10 bundles its TypeScript declarations, so `@types/nodemailer` must not be
installed beside it — the two declare the same module and conflict. `npm ls nodemailer` should report
exactly one entry, and Nodemailer reports zero runtime dependencies of its own.

The peers are declared with wide ranges (`^4.0.2`, `^3.18.2`, `^0.1.5-rc.1`) on purpose: the plugin
must share one Cordis and one Schemastery instance with the host. Pinning exact versions invites a
second copy of either, which means two mutually invisible service registries.

## 2. Build

```powershell
npm install
npm run typecheck
npm test
npm run build
```

| Step | Command | Expected |
| --- | --- | --- |
| Install | `npm install` | `node_modules` created; `nodemailer` is the only runtime dependency |
| Typecheck | `npm run typecheck` | Exit 0, no output. Runs `tsc --noEmit` over `src` and again over `src` + `tests` + `scripts` |
| Test | `npm test` | `node --test "tests/**/*.test.ts"`; all tests pass, nothing skipped, no network |
| Build | `npm run build` | Exit 0; `lib/*.js` plus `lib/types/*.d.ts` emitted |

There is no lint step: the frozen specification does not require one and this repository declares no
linter configuration, so no lint claim is made.

## 3. Pack

```powershell
npm pack                    # -> dsh-mail-notify-<version>.tgz, e.g. dsh-mail-notify-0.1.1.tgz
npm run pack:check          # audits the archive
```

`package.json` uses `files` as a **whitelist**: `lib`, `cordis.patch.yml`, `README.md`, `LICENSE`.
Anything not listed cannot enter the archive, which is how `.env`, key material, tests, and
development scripts are excluded structurally rather than by remembering to exclude them.

`npm run pack:check` re-derives that whitelist, confirms each declared entry is present, checks that
a compiled runtime exists under `lib/`, and matches every archive path against a deny list of
secret-bearing and development patterns. It prints the full entry list and ends with `PASS` or a
`FAIL` block naming each problem.

`*.tgz` is ignored by git, so the archive is a local verification artefact and is never committed.

## 4. Install

```powershell
dsh plugin --profile <profile> add ./dsh-mail-notify-<version>.tgz
```

This forwards to pnpm inside the profile directory, installs the package, and — because
`package.json` declares `dsh.bundle.patch` — appends the package name to `dsh.profile.bundles`.

Verify:

```powershell
dsh plugin --profile <profile> list
# dsh-mail-notify must appear in the dependency list

dsh --profile <profile> --dump-config | Select-String -Pattern 'dsh-mail-notify' -Context 0,3
# the row must appear with the config from the package's own cordis.patch.yml
```

The shipped row sets `enabled: false`, so a fresh install registers nothing until configured. A row
is inert by default and cannot mail an unconfigured recipient.

**Restart the profile.** The `web` and `headless` profiles set `patchReload: startup`, so a new row
takes effect on the next boot rather than live. A custom profile may default to `live`, in which
case editing its patch file is enough.

## 5. Configure and verify

Add the row described in [`../README.md`](../README.md#configure) to the profile's own
`cordis.patch.yml`, restart, and look for `plugin.ready` in the log. Because the `dsh` command line
registers no log exporter, the plugin's lines are only visible with an exporter attached; the
development probe in this repository does that without modifying the harness:

```powershell
node scripts/dev-boot-probe.mjs --profile <profile> --only dsh-mail-notify -- "<a short task>"
```

Delete the row and restart to remove the configuration.

## 6. Update

```powershell
npm pack
dsh plugin --profile <profile> add ./dsh-mail-notify-<version>.tgz
```

pnpm replaces the installed copy; the profile's own patch file is not touched. Restart afterwards.

Bump `version` in `package.json` before packing an update: the archive name carries it, and two
different builds sharing one version number cannot be told apart in a profile listing.

## 7. Roll back

Three levels, in increasing scope:

| Scope | Action |
| --- | --- |
| Stop sending, keep the installation | Set `enabled: false` in the profile patch and restart. No listener, no queue, no credential read. |
| Undo a configuration change | Restore the previous `cordis.patch.yml` (back it up before editing) and restart. |
| Remove the plugin | `dsh plugin --profile <profile> remove dsh-mail-notify`, then restart. Confirm the row is gone from `--dump-config`. |

Nothing in this plugin writes outside its own process. It holds no files, opens no database, and
persists no state, so a rollback leaves nothing behind beyond the configuration you edited.

Rolling back a **development injection** is different: if the plugin was loaded through the
super-injector rather than installed as a package, use the injector's own uninstall path. That path
removes the loader entry, deletes the profile junction, and records a `disabled: true` row for the
id in the profile patch so a later refresh cannot re-add it. That disabled row is written by the
injector; a normal `dsh plugin add` install does not create one.

## 8. Release checklist

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` passes with zero skipped
- [ ] `npm run build` exits 0
- [ ] `npm pack` produces the expected filename
- [ ] `npm run pack:check` prints `PASS`
- [ ] the archive's `lib/**` matches the current build byte for byte
- [ ] the archive contains no secret-bearing or development entry
- [ ] installing the archive into a fresh profile makes the row appear in `--dump-config`
- [ ] `enabled: false` produces `plugin.disabled` and registers nothing
- [ ] `enabled: true` produces `candidate.produced` for a real top-level turn
- [ ] `candidate.produced` reports `usageSampleCount` equal to the turn's model-call count
- [ ] uninstalling leaves no row and no residual state
- [ ] `git status` shows no credential, no `.env`, and no archive

## 9. Version history

| Version | Status | Substance |
| --- | --- | --- |
| `0.1.0` | released | First release. `schemaVersion: 1`; `usage` carried the last observed per-call sample. |
| `0.1.1` | release candidate | `usage` is the turn-level aggregate of observable per-call counters; `schemaVersion: 2`; `usageComplete` added; body labels the aggregate as such (D017). No configuration field changed, so an existing profile patch needs no edit. |

A `0.1.0` candidate record and a `0.1.1` candidate record for the same turn usually carry
**different** `usage` values and always carry different `schemaVersion` values. The version field is
the discriminator; a reader that ignores it will read a v2 aggregate as a v1 last-call sample.
