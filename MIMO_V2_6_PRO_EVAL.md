# MiMo-V2.6-Pro v0.3.1 Evaluation

Model:
mimo-v2.6-pro

Base:
v0.3.0

Base commit:
b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4

Branch:
eval/mimo-v2.6-pro-v0.3.1-ui

DSH:
0.1.5-rc.2

Baseline:
- check:text: PASS (110 text files scanned; strict UTF-8, BOM-free, no mojibake)
- typecheck: PASS (three programs: tsconfig.json --noEmit, tsconfig.client.json, tsconfig.test.json)
- tests: 451 passed / 0 failed / 0 skipped (run after `npm run build`; see ordering note below)
- build: PASS (tsc host emit + tsc client declarations + tsdown client bundle, lib/client.js 46.10 kB)

Baseline ordering note (observable, not a defect): `tests/package/tarball.test.ts` runs
`npm pack` against the working tree and asserts on the packed `lib/` output. Running
`npm test` before `npm run build` on a clean checkout fails exactly 5 package tests
(PKG-01, PKG-01c, PKG-02b, "every relative import…", "the compiled entry point loads…")
with `lib/` missing; the same suite passes 451/451 once `npm run build` has emitted `lib/`.
Both runs were executed and recorded; the effective baseline order is build → test.

Environment (observed):
- node v24.13.0
- npm 11.12.0
- pnpm 11.7.0
- dsh 0.1.5-rc.2
- worktree: E:\Projects\DSHarness\dsh-mail-notify-mimo-pro (created from tag v0.3.0)
- HEAD == merge-base(HEAD, v0.3.0) == b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4 before implementation

Repository-state observations at start:
- The shared repository's main checkout was on branch `eval/gemini-3.8-flash-v0.3.1-ui`
  (clean), and a second worktree `dsh-mail-notify-ds41` existed for
  `eval/deepseek-v4.1-flash-v0.3.1-ui`. No file content from any evaluation branch was
  read; all work happened inside the isolated worktree created from tag v0.3.0.
- v0.3.0 tag resolves to annotated tag object 2ee3141f1d86710f527e831fd34d599a8052fef9
  with commit b352c91193ad1cfcb22e551e5dbcc425dcc2e9e4, matching the expected release
  baseline exactly.

Telemetry: harness exposes no token/cost counters to the model; none are estimated.

(Sections to be completed at the end of the run.)
