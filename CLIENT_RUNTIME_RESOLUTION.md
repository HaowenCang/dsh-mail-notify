# dsh-mail-notify — 客户端运行时解析图（v0.3.0）

本文件回答一个问题：**v0.3.0 的浏览器半侧，从类型检查到构建到运行时，实际解析到的是哪些包、哪些路径、哪些版本**，以及 `0.1.0-rc.7` 残留是否会进入这条路径。

结论先行：**最终被测路径上不存在 rc.7 污染**，且该结论不是"读文件推断"得来的，而是由三条独立证据共同支撑——编译期程序清单、浏览器启动图的模块行、以及宿主源码中零处主机侧引用。残留本身位于一处**共享**的 junction 农场（`%DSH_HOME%\profiles\node_modules`），它是环境的既有产物，不是本包的依赖，也不在任何一条通路上。

---

## 1. 目标运行时

| 项 | 实测值 |
| --- | --- |
| DSH 版本 | `0.1.5-rc.2`（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh\package.json`） |
| Web 前端包 | `@deepseek-ai/dsh-web-frontend@0.1.5-rc.2` |
| 浏览器外壳 bundle | `…\dsh-web-frontend\dist\assets\index-BKQ_L1z6.js` |
| Node / npm / pnpm | `v24.13.0` / `11.12.0` / `11.7.0` |
| 被测 profile | `mnv030`（`--from-default-profile web` 新建，bundle 仅 `dsh-base` + `dsh-web-app` + `dsh-mail-notify`） |

---

## 2. 三层解析，逐层记录

外部客户端插件同时受三套解析规则支配，它们的输入不是一个东西，必须分开记录。

### 2.1 TypeScript —— 项目本地、全部精确钉版

`tsconfig.json` 的 `devDependencies` 是编译期唯一输入。全部钉在 **`0.1.5-rc.2`**，且实测无嵌套副本（`node_modules/@deepseek-ai/` 下每包一份）：

| 包 | 解析版本 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | 4.0.2 | Service / Context 基座 |
| `@deepseek-ai/dsh-api-remotes` | 0.1.5-rc.2 | `ctx.remote` 与 `SettingsPathOpView` |
| `@deepseek-ai/dsh-api-settings-controller` | 0.1.5-rc.2 | `credentials` Remote 命名空间声明（`./remote`） |
| `@deepseek-ai/dsh-client-connection` | 0.1.5-rc.2 | `ctx.connection`、`ClientConnectionRpc` |
| `@deepseek-ai/dsh-client-ui-renderer` | 0.1.5-rc.2 | `ctx.slots`、`SlotRegistry` |
| `@deepseek-ai/dsh-client-ui-settings` | 0.1.5-rc.2 | `ctx.settingsScope`、`SettingsScope` |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | 0.1.5-rc.2 | `settings.plugin.item` 的 SlotMap 声明 |
| `@deepseek-ai/dsh-client-ui-slots` | **0.1.5-rc.2** | `SlotMap`、`PropsRuntime`、`ComposedProps` |
| `@deepseek-ai/dsh-credentials` | 0.1.5-rc.2 | `CredentialInfo` |
| `@deepseek-ai/dsh-session` | 0.1.5-rc.2 | `session/event`、`session/disposed` 事件声明 |
| `@deepseek-ai/dsh-settings` | 0.1.5-rc.2 | `ctx.settings`、`SettingsSectionHooks` |
| `@deepseek-ai/schemastery` | 3.18.2 | 配置 schema |
| `react` / `react-dom` | 18.3.1 | 仅类型（运行时由外壳种子表提供） |
| `@types/react` / `@types/react-dom` | 18.3.27 / 18.3.7 | JSX 类型 |

**关键事实：`@deepseek-ai/dsh-client-ui-slots` 在 rc.2 全局安装树中并不存在，但它在 npm 上以 `0.1.5-rc.2` 发布**，且 `dist-tags.next` 正指向它——`latest` 指向陈旧的 `0.0.1-rc.1`。这正是本机 rc.7 残留的成因：一次不带版本的安装把 `latest`/旧版解析进了共享农场。本项目按**精确版本**声明，因此不受该陷阱影响。

编译期程序清单（`tsc -p tsconfig.client.json --listFilesOnly`，272 个文件）实测只包含上述本地副本，**不含 npx 缓存中的任何文件**。

### 2.2 客户端 bundle 构建 —— 单一 CJS 信封，仅两个外部符号

`tsdown.config.ts` 产出 `lib/client.js`（46.1 kB）。实测该产物：

- 顶层 `import`/`export` 语句数 = **0**；
- `require(...)` 全集 = **`react`、`react/jsx-runtime`** 两项；
- 信封为 `window.__ModuleLoader__.load({ id: "dsh-mail-notify", factory: (require) => { var module = { exports: {} }; … return module.exports; } })`。

这两项都是外壳种子词，因此构建产物在运行时**不可能**解析到磁盘上的任何 React 或 DSH 客户端包——包括 rc.7 残留副本。

`deps.neverBundle` 只有 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`。其余一切 DSH 契约都是 `import type`，在进入模块图之前已被擦除。

### 2.3 DSH 客户端模块加载器 —— 种子表优先

`…\dsh-client-modules\lib\client.js:300-309` 逐字：

```js
return (spec) => {
    edges.add(spec);
    if (this.seed.has(spec)) return this.seed.get(spec);
    const id = stripClientSuffix(spec);
    const record = this.loadCache.get(id);
    if (record !== void 0) return record.exports;
    if (this.factories.has(id)) return this.materialize(id).exports;
    throw new Error(`client-modules: require("${spec}") missed the module table — …`);
};
```

顺序是 **种子表 → 已物化模块 → 已注册工厂**。外壳（`dsh-web-frontend@0.1.5-rc.2`）注入的种子表逐字为：

```js
function by(){return{react:ec,"react/jsx-runtime":ic,"react-dom":cc,"react-dom/client":fc,
"@deepseek-ai/cordis":Ha,"@deepseek-ai/dsh-client-store":Hc,"@deepseek-ai/dsh-client-ui-slots":Ac,
"@deepseek-ai/dsh-client-ui-primitives":Zg,"@deepseek-ai/dsh-client-ui-dockkit":Ey}}
```

`@deepseek-ai/dsh-client-ui-slots` 与 `@deepseek-ai/dsh-client-ui-primitives` **都在种子表内**，所以 37 个已发布客户端 bundle 里对 `dsh-client-ui-primitives` 的 `require`、6 个对 `dsh-client-ui-slots` 的 `require`，全部由外壳自身那份回答，磁盘上的同号目录不参与。

---

## 3. rc.7 残留的实际范围与不可达性证明

### 3.1 残留位置

全部位于 **`C:\Users\20659\.dsh\profiles\node_modules\@deepseek-ai\`**（跨 profile 共享的 fallback 农场），共 5 项指向 npx 缓存 `…\npm-cache\_npx\1e7f6d9597241db0\`：

```
dsh-client-ui-slots          → 0.1.0-rc.7
dsh-client-ui-primitives     → 0.1.0-rc.7
dsh-client-schema-form       → 0.1.0-rc.7
dsh-client-web               → 0.1.0-rc.7
dsh-client-web-react         → 0.1.0-rc.7
```

同一农场内其余约 250 项均指向 rc.2 全局树。该农场**不是本包创建或修改的**；它是本机既有的环境状态，本文只做隔离证明，不改动它——改动该目录会同时影响用户正在运行的 `web` profile。

### 3.2 三条独立证据

**证据一：合成后的 Loader 配置零命中。** `dsh --profile mnv030 --dump-config` 的全部条目中，上述 5 个包名各命中 0 次。

**证据二：浏览器启动图的模块行零命中。** 从索引 HTML 的 `globalThis["__DSH_BOOT__"]` 取出实际下发的 54 行模块图，上述 5 个包名（连同 `dsh-client-runtime`、`dsh-host-apiproxy`、`dsh-tool-subagent-report`）**全部 absent**。同一份图内，本包 `dsh.client.inject` 声明的 5 个依赖**全部 in graph**：

```
dsh-mail-notify → inject: [dsh-client-ui-renderer, dsh-client-ui-settings,
                           dsh-client-ui-settings-plugins, dsh-client-connection, dsh-api-remotes]
```

**证据三：宿主源码零引用。** 对 rc.2 全树按 `require("@deepseek-ai/<pkg>")` 检索：

| 包 | 主机侧（`lib/index.js`） | 浏览器 bundle（`lib/client.js`） |
| --- | --- | --- |
| `dsh-client-ui-primitives` | **0** | 37 |
| `dsh-client-ui-slots` | **0** | 6 |

主机侧零引用意味着：进程内不存在任何路径会去解析这两个目录。浏览器侧的引用由第 2.3 节的种子表回答。

### 3.3 被排除的第三个候选

`@deepseek-ai/dsh-client-store` 在两条解析路径下均为 **UNRESOLVED**（rc.2 全局树、profile 农场都没有），且**本包从不导入它**——构建产物实测 `require` 全集只有 `react` 与 `react/jsx-runtime`。卡片的状态订阅用 React 自带的 `useSyncExternalStore`，而不是 `SnapshotStore`，因此不存在"因为出现在种子词里就顺手 import"的情况。

---

## 4. 被测 profile 的实际解析结果

自 profile 根目录发起的 Node 解析（`createRequire(profile/package.json)`）：

| 请求 | 版本 | 解析路径 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | 4.0.2 | `…\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\cordis` |
| `@deepseek-ai/dsh-client-ui-renderer` | 0.1.5-rc.2 | 同上（rc.2 全局树） |
| `@deepseek-ai/dsh-client-ui-settings` | 0.1.5-rc.2 | 同上 |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | 0.1.5-rc.2 | 同上 |
| `@deepseek-ai/dsh-client-connection` | 0.1.5-rc.2 | 同上 |
| `@deepseek-ai/dsh-api-remotes` | 0.1.5-rc.2 | 同上 |
| `@deepseek-ai/dsh-settings` | 0.1.5-rc.2 | 同上 |
| `@deepseek-ai/schemastery` | 3.18.2 | 同上 |
| `nodemailer` | 10.0.10 | `…\profiles\mnv030\node_modules\nodemailer` |
| `dsh-mail-notify` | 0.3.0 | `…\profiles\mnv030\node_modules\dsh-mail-notify` |
| `@deepseek-ai/dsh-client-ui-slots` | 0.1.0-rc.7 | npx 缓存（**不在通路上**，见 §3） |
| `@deepseek-ai/dsh-client-ui-primitives` | 0.1.0-rc.7 | npx 缓存（**不在通路上**，见 §3） |
| `@deepseek-ai/dsh-client-store` | UNRESOLVED | —（本包不导入） |
| `react` / `react-dom` | UNRESOLVED | 由外壳种子表提供 |

---

## 5. 版本错位是如何被消除的

初版实现曾出现两类真实的类型错位，都不是用 `any` 或复制陈旧声明绕过的：

**其一，`dsh-client-ui-slots` 只有 rc.7 可用。** 修法是按精确版本 `0.1.5-rc.2` 安装发布版，而不是让范围解析落到 `dist-tags.latest`。这是一次依赖声明修正，不是类型断言。

**其二，`ctx.connection` 在宿主与浏览器两侧由同一声明点声明为不兼容的两个类型。** `@deepseek-ai/dsh-client-connection` 的 host 入口把 `Context.connection` 声明为 `HostConnectionHandle`，浏览器入口声明为 `ConnectionHandle`；把两半放进同一个 TypeScript 程序会得到 `TS2717: Subsequent property declarations must have the same type`。修法是**把两半拆成各自的编译程序**（`tsconfig.test.json` 只含主机侧与主机侧测试，`tsconfig.client.json` 含浏览器侧与客户端测试），而不是把某一侧断言成 `any`。拆开后每个程序读到的正是它实际运行所依据的那份契约。

浏览器侧缺失的 `Context.connection` 声明则在 `src/client/contracts.ts` 中以**该包自己发布的 `ConnectionHandle`** 补出，而不是重述一个结构等价物——方法被改名时该文件必须编译失败，而不是继续悄悄通过。

---

## 6. 运行时跨包边界

客户端 bundle 在运行时只 `require` 两个种子词。它与 DSH 的全部其余交互都经 Cordis 服务，而不是模块导入：

| 用途 | 服务 | 由谁提供 |
| --- | --- | --- |
| 插槽注册 | `ctx.slots` | `dsh-client-ui-renderer` |
| 设置命名空间读写 | `ctx.settingsScope` | `dsh-client-ui-settings` |
| 凭据 describe/set/unset | `ctx.remote.credentials` | `dsh-api-remotes`（命名空间声明来自 `dsh-api-settings-controller`） |
| 状态读取与测试邮件 | `ctx.connection.rpc.call` | `dsh-client-connection` |

`dsh.client.inject` 中的 5 个包名是**模块图边**（保证这些 bundle 在本包之前到达）；`src/client/index.tsx` 中的 `inject` 数组是**服务可用性门**（`slots`、`settingsScope`、`connection`、`remote`、`remote.credentials`）。两者不是同一条声明，缺任一条都会以不同方式失败，因此都显式列出。

---

## 7. 复现命令

```powershell
# 1) 编译期：确认客户端程序只含项目本地副本
npx tsc -p tsconfig.client.json --listFilesOnly | Select-String 'dsh-mail-notify/src|node_modules'

# 2) 构建产物：确认外部符号恰为两个种子词
(Select-String -Path lib\client.js -Pattern 'require\("([^"]+)"\)' -AllMatches).Matches.Value | Sort-Object -Unique

# 3) 运行时：确认浏览器模块图不含 rc.7 包名
$html = (Invoke-WebRequest "http://127.0.0.1:<port>/?token=<token>" -UseBasicParsing).Content
$i = $html.IndexOf('globalThis["__DSH_BOOT__"] = ')
$boot = ($html.Substring($i + 30, $html.IndexOf('</script>', $i) - $i - 30).Trim().TrimEnd(';')) | ConvertFrom-Json
$boot.entries.id | Sort-Object

# 4) 宿主侧：确认零主机代码引用陈旧包
Get-ChildItem $env:APPDATA\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai -Recurse -Filter *.js |
  Where-Object { $_.FullName -notmatch 'client\.js$' } |
  Select-String 'require\("@deepseek-ai/dsh-client-ui-(slots|primitives)"\)'
```

---

## 8. 结论

- 类型、构建、运行时三层解析到的 DSH 客户端包**全部是 `0.1.5-rc.2`**，且每包单份。
- 构建产物在运行时只依赖外壳种子表的 `react` 与 `react/jsx-runtime`；不存在第二份 React，也不存在 Cordis 双运行时。
- `@deepseek-ai/dsh-client-store` 未被导入，也未被声明为依赖。
- 本机 5 项 rc.7 junction 位于共享 fallback 农场，**不在本包的依赖、Loader 配置、浏览器模块图或宿主源码引用中的任何一条通路上**；本文以隔离而非改名的方式处理，因为改动该目录会波及用户正在运行的 profile。
