# Phase 8.2 — RC Documentation Consistency Closure

本阶段为纯文档阶段：不新增功能、不修改运行时行为，不触碰 `src/**`、`tests/**`、`scripts/**`、`package.json`、`package-lock.json`、`cordis.patch.yml`。

## Status

PASS — 文档一致性已收敛，v0.2.0 达 RC 状态。未发布、未打 tag、未合并 `main`。

## Starting SHA

```text
68d5a2dba4453fb0df9731e636accc8d8cc7a4f8
```

分支 `feat/v0.2.0-human-attention`，起始工作树干净。

## Files changed

| 文件 | 变更 |
| --- | --- |
| `docs/DECISIONS.md` | D001 Decision 段改写（3 行 → 5 行）；D018 Consequences 的失效条替换为撤销说明（−1/+2 行） |
| `docs/CONFIG_SPEC.md` | 第 1 节字段表下方一条括注改写（1 行） |
| `PHASE8_2_REPORT.md` | 本文件（新增） |

无其它文件变更。`git diff --name-only` 仅含上述文档。

## D001 correction

原文断言：

```text
插件唯一的事件观察入口是顶层 Cordis 事件 `session/event` …
……在单一监听器内按 `event.type` 分派。
```

Phase 8 起，`src/index.ts` 对同一顶层事件名 `session/event` 注册**两次**（Turn 状态维护 + 仅观察 `approval/asked`），因此「单一监听器」不再成立。

改写后的不变量是**事件名唯一**，而非回调数量唯一：

- `session/event` 是插件使用的唯一顶层 SessionEvent Cordis 事件名；
- `turn/start`、`assistant/message`、`tool/call`、`tool/result`、`turn/end`、**`approval/asked`** 均为 `SessionEvent.type` 的成员；
- 主监听器按 `event.type` 分派普通 Turn 状态；Phase 8 另注册同名 observer，仅观察 `approval/asked`；
- 两者都经 Runtime Adapter 与有界观察路径，且都不注册 `user-questions/request` 或 `approval/request`。

历史理由（Phase 1 运行时确证四个「事件」实为同一事件成员）与三条 Rejected alternatives 未改写：它们针对的是「注册为独立顶层事件不可行」，与回调数量无关，仍然成立。

## D018 / D019 correction

D018 Consequences 中原有一条被删除线覆盖、但正文仍保留失效技术解释的条目：

```text
~~CREDENTIAL_REF_PATTERN 放宽为同时接受裸名与 <scope>/<id> 寻址。~~
**该条已在 Phase 8.1 撤销，理由见 D019。** 运行时取证发现二者都是合法引用：
Credential store 只接受 <scope>/<id>（每段 ^[a-z][a-z0-9-]*$），而本项目历史上只校验裸名……
```

删除线之后的三句是 Phase 8 的错误诊断本身，与 D019 直接冲突：`CredentialRef` 不接受 `<scope>/<id>`；`resolve()` / `describe()` 只读 `refs` 段、从不查询 `records`；两个键空间不是同一组合法 `smtpPasswordCredential` 取值。

替换为不含任何技术断言的撤销说明：

```text
- ~~Phase 8 曾把 CREDENTIAL_REF_PATTERN 放宽为同时接受裸名与 <scope>/<id>。~~
  **该诊断与实现均已在 Phase 8.1 撤销；现行凭据契约完全由 D019 定义。**
```

D019 未改动，仍是凭据契约的唯一权威来源。D018 的其余 Consequences（含「`src/index.ts` 注册两个 `session/event` 监听器」一条）与实现一致，未改写。未新增 D020：本阶段只做编辑性对齐，不产生新的架构裁决。

## Search results for stale claims

检索式：`Credential store 只接受` / `二者都是合法引用` / `<scope>/<id> 寻址` / `credentials/smtp-password` / `放宽 CREDENTIAL_REF_PATTERN`。

| 位置 | 类别 | 处置 |
| --- | --- | --- |
| `docs/DECISIONS.md` D018 Consequences | 规范性·失效 | **已改正**（见上） |
| `docs/CONFIG_SPEC.md` 第 1 节 | 规范性·失实暗示 | **已改正**：原括注「该模式在 Phase 8 放宽」在陈述当前校验时隐含放宽仍生效，改为指明即 `CredentialRef` 文法且该放宽已撤销 |
| `docs/DECISIONS.md` D019 | 规范性·现行 | 无需改动，D019 即撤销裁决本身，措辞正确 |
| `00_MASTER.md` 第 15 节 | 规范性·现行 | 明确标注 Phase 8.1 更正，结论正确 |
| `docs/ARCHITECTURE.md` | 规范性·现行 | Phase 8.1 撤销说明完整，结论正确 |
| `docs/CONFIG_SPEC.md` 第 2.2 节、第 38 行补记 | 规范性·现行 | 结论正确（`<scope>/<id>` 被拒绝） |
| `docs/RELEASE.md` | 规范性·现行 | 正确：单一文法，Phase 8 放宽注明已在 8.1 撤销 |
| `docs/TEST_PLAN.md` CRED-01 | 规范性·现行 | 正确：断言插件文法副本与 DSH 辅助函数一致 |
| `tests/integration/credential-contract.test.ts`、`tests/unit/config.test.ts`、`src/config.ts`、`scripts/probe/credential-contract.mjs` | 可执行文件·现行 | 正确：均测试/实现**拒绝** `<scope>/<id>`。按本阶段约束未改动 |
| `PHASE8_REPORT.md` | 历史·已标注 | 原诊断带删除线，紧随一段「该诊断经 Phase 8.1 复核不成立，放宽已撤销」的明确更正，并指向 `PHASE8_1_REPORT.md` 与 D019。符合「保留事实但标注已更正」，未改写 |
| `PHASE8_1_REPORT.md` | 历史·证据 | 撤销过程的取证记录（含探针输出）。不得改写，未改动 |

结论：无任何现行规范性文档仍把 Phase 8 的错误解释表述为当前行为。

## Listener wording search

检索式：`single listener` / `单一监听器` / `唯一 listener` / `one session/event listener`。

唯一命中为 `docs/DECISIONS.md` D001（本次已改正）。同义表述的复查结果：

| 位置 | 陈述 | 判定 |
| --- | --- | --- |
| `docs/ARCHITECTURE.md` L27/L54/L139/L141/L596 | 明示 `session/event` 上两次注册、`session/disposed` 一次 | 与实现一致 |
| `docs/DECISIONS.md` D018 L950 | 注册两个 `session/event` 监听器 | 与实现一致 |
| `docs/DSH_INTEGRATION.md` L22 | 「唯一的事件观察入口」+ 表格 | 指入口名称唯一，未断言回调数量，成立 |
| `docs/TEST_PLAN.md` ADP-06 | 「注册表只含 `session/event` 与 `session/disposed`」 | 指事件名集合，成立 |
| `docs/CONFIG_SPEC.md` L51/61/278、`docs/RELEASE.md` L170、`docs/SECURITY.md` L23 | `enabled: false` 不注册任何监听器 | 成立 |
| `PHASE3_REPORT.md` L99 | 「exactly two listeners registered」 | 历史快照，Phase 3 时属实；未改写 |
| `PHASE4_1_REPORT.md` L202 | `{"session/event":1,"session/disposed":1}` | 历史探针原始输出（rc.2 期）；未改写 |

经核实，v0.2.0 实现的实际注册集合为：

```text
2 × session/event 回调      （src/index.ts:187 Turn 状态，:215 approval 观察）
1 × session/disposed 回调   （src/index.ts:192）
0 × user-questions/request 回调
0 × approval/request 回调
```

`src/` 中 `ctx.on` 共 3 处。文档一律以实现为准，未为迁就旧文字改动任何代码。

## Verification

| 项目 | 结果 |
| --- | --- |
| `git diff --name-only <starting-sha>..HEAD` | 仅 `docs/CONFIG_SPEC.md`、`docs/DECISIONS.md`（+ 本报告）。不含 `src/**`、`tests/**`、`scripts/**`、`package.json`、`package-lock.json`、`cordis.patch.yml` |
| `npm run check:text` | PASS — 96 个文本文件，严格 UTF-8、无 BOM、无已知 mojibake |
| `git diff --check` | PASS — 无空白/冲突标记问题 |
| `npm run typecheck` | PASS — 两个 tsconfig 均退出 0 |
| `npm test` | PASS — 409 pass / 0 fail / 0 skipped（与阶段下限精确一致） |

diff 为纯文档变更，因此未重复 SMTP / approval / credential E2E 探针，亦未为从可执行输入制造新证据而重新构建或打包。

## Final SHA

```text
<filled after commit>
```

## Remote SHA

```text
<filled after push>
```

## RC status

v0.2.0 RC READY。Phase 8 / 8.1 / 8.2 关闭。本阶段未发布、未打 `v0.2.0` tag、未合并 `main`；下一阶段可执行合并冻结与正式发布。
