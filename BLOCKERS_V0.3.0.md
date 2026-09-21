# dsh-mail-notify Web 配置界面 — 阻断报告与处置结论（v0.3.0 candidate）

> ## RESOLVED — accepted `settings.plugin.item` implementation path
>
> 本文件最初记录的是任务书 §26 的第一条停止条件：指定的配置槽位 `plugins.row.config` 及其键 `dsh-mail-notify#dsh-mail-notify` 在已安装的 DSH 中不存在（§2、§3）。
>
> **该阻断已由产品决策解除**：验收标准改为"DSH 0.1.5-rc.2 能发现本包的 `dsh.client` bundle，且 `Settings → Plugins → Plugin configuration` 通过 `settings.plugin.item`（键 `dsh-mail-notify`）显示可用的 dsh-mail-notify 配置面"。实现已按零上游改动完成并通过真实应用验证。
>
> 原文的调查证据（槽位检索、键域分析、替代座位、未触发的停止条件、凭据面只写性）**保留在下方**，因为它们仍是本次实现所依据的契约事实。§5.1 的"上游改动方案 A"**不予采纳**。
>
> 新增两节记录实现过程中发现的两条真实约束（§10、§11），它们取代了本文件原 §5.2 中若干尚未验证的设想。

---

## 1. 开发与验证环境（实测）

| 项 | 实测值 | 证据 |
| --- | --- | --- |
| DSH 版本（开发与验证的权威版本） | `@deepseek-ai/dsh@0.1.5-rc.2` | `C:\Users\20659\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\package.json` 的 `"version"` |
| Web 前端包 | `@deepseek-ai/dsh-web-frontend@0.1.5-rc.2` | 同树 `dist\assets\index-BKQ_L1z6.js` |
| 第二棵 DSH 树（npx 缓存） | `0.1.0-rc.7` | `…\npm-cache\_npx\1e7f6d9597241db0\` |
| 本次验证 profile | `mnv030`（可丢弃，`--from-default-profile web` 新建） | `C:\Users\20659\.dsh\profiles\mnv030\package.json` |
| 用户的常驻 profile | `web`（`dsh.profile.bundles` 含 `dsh-mail-notify`） | `C:\Users\20659\.dsh\profiles\web\package.json` |
| Node / npm / pnpm | `v24.13.0` / `11.12.0` / `11.7.0` | `node -v`、`npm -v`、`pnpm -v` |
| `DSH_HOME` | `C:\Users\20659\.dsh` | 进程环境 |

**关于两棵树的混用**：第 6 节原把它列为遗留风险。该风险已在本轮**定位、量化并证明不可达**，完整解析图见 `CLIENT_RUNTIME_RESOLUTION.md`。结论是：5 项 rc.7 junction 位于共享 fallback 农场 `…\profiles\node_modules\@deepseek-ai\`，但既不在合成 Loader 配置中、也不在浏览器启动图的 54 行模块里、更不被任何主机侧代码 `require`。类型、构建、运行时三层解析到的 DSH 客户端包全部为 `0.1.5-rc.2`。

---

## 2. 原始阻断点一：`plugins.row.config` 不存在（历史证据，已由决策解除）

### 2.1 检索证据

对三处根目录做全树检索，模式为 `plugins\.(row|bundle)\.config|plugins\.item|plugins\.row`：

| 检索根 | 结果 |
| --- | --- |
| `…\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai`（0.1.5-rc.2 全量包） | **No matches found** |
| `…\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai`（0.1.0-rc.7 全量包） | **No matches found** |
| `…\profiles\web\node_modules\<各外部插件>` | 仅一处假阳性，见 2.3 |

任务书 §2 预期存在的三个槽位中，`plugins.item` 与 `plugins.bundle.config` 同样零命中。这不是"未安装某包"造成的缺项，而是该命名空间在当前 DSH 中整体不存在。

### 2.2 实际存在的扩展点

当前 DSH 的 Plugins 页面暴露的插件自有配置座位是 **`settings.plugin.item`**。类型契约逐字如下（`…\dsh-client-ui-settings-plugins\lib\types\client\slot-contract.d.ts`）：

```ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'settings.plugin.item': {
            kind: 'keyed';
            scope: 'root';
            owner: SettingsPluginItemOwnerProps;
        };
    }
}
export interface SettingsPluginItemOwnerProps {
    /** Marker field: card owner props are intentionally empty. */
    children?: never;
}
```

该文件同时逐字写明这一座位就是为仓库外部插件准备的：

> Keying on the namespace is what lets a plugin distributed outside this repository contribute a card: it registers its own settings namespace on the Host and its own card under that key in the browser, and the tab pairs the two without ever learning what the namespace means.

同包 `README.md` 亦逐字确认：

> A plugin that ships a browser half registers its own card under its own namespace and owns every part of it: chrome, controls, and copy.

运行期声明链（`…\dsh-client-ui-settings-plugins\lib\client.js`）：`settings.section` 的 `plugins` 条目声明子槽 `settings.plugins.tab`；`settings.plugins.tab` 的 `configurable` 条目再声明子槽 `settings.plugin.item`：

```js
ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
    name: "settings.plugins.tab", id: "configurable", order: 0, label: () => t("configurableTab"),
    locale: NS, inject: () => configurable.inject(),
    children: { "settings.plugin.item": { kind: "keyed", scope: "root" } }
}, ConfigurablePluginsTab));
```

派发点逐字（同文件 `:416`）：

```js
children: namespaces.map((ns) => renderSlot("settings.plugin.item", {}, { entryKey: ns }))
```

因此本版本的用户路径是 `Settings → Plugins → Plugin configuration 标签 → 每个设置命名空间一张卡片`。**本次实现正是按这条链路的真实契约完成的**，未改动 DSH 任何代码。

### 2.3 一处假阳性（已排除）

`@linxin666/dsh-web-all` 的 `lib\client.js` 匹配到子串 `plugins.item`，逐字检查后确认是市场数据对象的属性访问（`plugin: plugins.items ?? []`），与槽位无关。该包若需自己的插件配置卡，采取的是**自建槽位** `web-ui.plugin.item`（`kind: 'list'`，`scope: 'root'`）——这反向印证核心 `settings.plugin.item` 是本版本唯一的核心插件配置座位。

---

## 3. 原始阻断点二：`dsh-mail-notify#dsh-mail-notify` 不是任何槽位的合法键（历史证据）

这一条在 `plugins.row.config` 缺席的前提下成立，其结论对 `settings.plugin.item` 同样重要：该槽是 `keyed` 槽且**未声明 `keyProps`**，故键域是开放字符串空间，语义上限定为**宿主插件已注册的设置命名空间**。运行期过滤器逐字为（`…\dsh-client-ui-settings-plugins\lib\client.js:1144-1145`）：

```js
const served = new Set(mirrored.view?.namespaces.map((view) => view.ns) ?? []);
const namespaces = this.entries().flatMap((entry) => entry.options.key !== void 0 && served.has(entry.options.key) ? [entry.options.key] : []);
```

即：注册键不在宿主已服务的命名空间集合内时，该卡片**永不派发**，且不计入空态行。`dsh-mail-notify#dsh-mail-notify` 属于另一个键空间（Loader 的 bundle 行身份），当前 DSH 没有任何槽位以它为键。

**本次实现据此采用单一键 `dsh-mail-notify`**，且宿主以同一字符串注册设置命名空间——两半由此配对。

---

## 4. 未触发的停止条件（逐条排除）

任务书 §26 列出的五项停止条件中，除第一项外**均不成立**；这一条在实现完成后依然成立，并已被真实运行验证逐条坐实。

| §26 停止条件 | 是否成立 | 证据 |
| --- | --- | --- |
| 已安装 DSH 不再暴露 `plugins.row.config` | 成立 → **已由决策解除** | §2；验收标准改指 `settings.plugin.item` |
| 外部 `dsh.client` 包当前无法从已安装的 bundle 加载 | 不成立 | 入口解析为 `exports["./client"]` → 字符串或 `{default: string}`，物理路径 `join(dirname(pkgJson), thatRel)`；`dsh.client.platform` 必须为字面量 `"web"`（`…\dsh-client-modules\lib\index.js:155-165,649-661`）。**本轮实测**：`dsh-mail-notify` 出现在 `__DSH_BOOT__` 的 54 行模块图中，`/plugins/??dsh-mail-notify/client.js` 正常下发 45 kB 信封 |
| Credentials 客户端 API 无法安全地做只写更新 | 不成立 | 浏览器面仅三个方法，无任何读取字面值的路径。逐字（`…\dsh-api-settings-controller\lib\typert.remote-client.d.ts`）：`credentials/describe`、`credentials/set`、`credentials/unset`。对 `lib` 全目录检索 `credentials/resolve|list|read|get` → **NONE**。**本轮实测**：卡片凭据状态显示"configured"，`set`/`unset` 均可用，浏览器代码中零处读取端点（`tests/client/wire.test.ts` WIR-12 断言） |
| 外部 Host 插件无法注册 Settings 命名空间 | 不成立 | 注册即 `ctx.settings.installSection(owner, ns, schema, entry, hooks)`，无包白名单；注册是调用方 fiber 上的 cordis effect。**本轮实测**：`settings.yaml` 出现 `dsh-mail-notify:` 段，卡片读取到该命名空间并显示"inherited"，插件由 `plugin.disabled` 转为 `plugin.ready` |
| 当前 Loader 无法在一个 npm 产物内同时承载 Host + Client | 不成立 | 本包 `files` 同时包含 `lib/index.js`（Host）与 `lib/client.js`（Client），`dsh.bundle.patch` 与 `dsh.client` 并存于同一 `package.json`；`dsh plugin add` 装入后 `bundles` 自动追加。**本轮实测**：单次 `pnpm add` 后 Host 与浏览器半侧同时生效 |

---

## 5. 处置：采用零上游改动的方案 B（已实施）

### 5.1 方案 A（上游改动）——不予采纳

原方案 A 需要在 DSH 核心新增 `plugins.row.config` 槽并在插件清单页派发它。这与"不得修改上游仓库"的约束直接冲突，且验收标准已修订，故**未实施，也不在本次交付范围内**。

### 5.2 方案 B（已实施）

不改任何 DSH 代码即达成实质目标——"用户在浏览器里配置 dsh-mail-notify，无需手改 `cordis.patch.yml`"。实际落地链路与最初设想的差异记在 §6：

1. **Host 设置命名空间**：`ctx.inject(['settings'], …)` → `settings.installSection(ctx, 'dsh-mail-notify', Config, entry, { setSource, onChange })`。`entry` 是组合配置，作为命名空间的 **base 层**；用户的 `settings.yaml` 段在其上覆盖；schema 默认值在最底层。这与任务书的优先级模型逐层同构，且"是否被用户覆盖"按**键的存在性**判定（`describe()` 的 `user` 层），不按值比较——Reset 因此天然意味着"移除用户层条目"，而不是"写回默认值"。
2. **配置即时生效**：`onChange` 触发重新解析并经结构指纹比对决定是否重挂运行时。实测：保存后卡片状态由"plugin not running"变为"plugin active"，无需重启。无法施行的配置（字段级校验失败）**不会**顶掉正在运行的运行时，而是记录并回报给界面。
3. **客户端 bundle**：`package.json` 增 `exports["./client"]` 与 `dsh.client: { platform: "web", inject: [...] }`，用 esbuild/rolldown 产出 lazy-CJS 信封（§6.2）。
4. **卡片注册**：`ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: 'dsh-mail-notify', inject: () => ({ card }) }, MailNotifyCardView))`。
5. **凭据**：口令经 `ctx.remote.credentials.describe/set/unset` 只写；`smtpPasswordCredential` 既有自定义引用保留在设置段内，不被覆盖。
6. **测试邮件**：经 `ctx.connection.rpc.call('/api', …)` 调用宿主精确路由，宿主侧复用**同一** `Deliverer`（即通知路径的凭据解析 + 传输构建 + 失败分类）。手写 Typert remote 仍不可行（客户端 `$mount` 强制 `codec.mode === 'strict'`）。

---

## 6. 实施中发现的真实约束（取代原 §5.2 的若干设想）

原 §5.2 的第 5、6 条是在未接触真实运行时的前提下写下的，其中两处与 rc.2 的实际契约不符。实测结果如下。

### 6.1 `HostConnectionRpc.handle` 在 rc.2 中不可用

原设想的"注册插件自有 RPC 通道"（`ctx.connection.rpc.handle('/dsh-mail-notify', …)`）会失败。逐字（`…\dsh-client-connection\lib\index.js:602-619`）：

```js
register(owner, channel, handler) {
    assertChannel(channel);
    const fetchHandler = rpcFetchHandler(channel, handler);
    const route = { kind: "prefix", path: channel, handler: … };
    return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`);
}
```

`owner` 取自 `get rpc() { const owner = this.ctx; … }`。在插件通过 scoped `ctx.inject(['connection', 'webServer'], …)` 调用时，该 `this.ctx` 解析到 **provider（连接插件自身）的上下文**，而它并不注入 `webServer`。实测报错逐字：

```
Error: cannot get property "webServer" without inject
```

即该 API 在 0.1.5-rc.2 中对任何插件都不可用。rc.2 全树检索 `rpc.handle(` **零命中**，说明它在本版本中无内部使用者。

### 6.2 `/api` 只容纳一个拦截器；精确 Fetch 路由是可行通路

`rpc.intercept('/api', …)` 逐字（同文件 `:620-633`）：

```js
registerInterceptor(owner, channel, matches, handler) {
    if (channel !== "/api") throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`);
    …
    if (this.interceptors.has(channel)) throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`);
```

**每个共享通道只允许一个拦截器**，而 `/api` 已被 Typert 网关占用（`dsh-api-gateway\lib\index.js:455`）。因此任务书建议的"Host 侧 `intercept('/api', …)`"在本版本**不可实施**。

可行且已实施的通路是 `HostConnectionFetch.register(route)`：共享处理器**先查精确路由、再问拦截器**（`:576-584`），所以挂在 `/api` 下的精确路由在拦截器被占用时依然可达，并且仍然位于 `/api` 的 Host/Origin 信任围栏与浏览器会话认证之后（`:771-777`）。两点端点为：

```
POST /api/dsh-mail-notify/status
POST /api/dsh-mail-notify/test-email
```

代价是 Connection 自带的信封编解码不会为这两条路由运行，因此由 `src/web-rpc.ts` 按其**已发布契约**（`ClientRequest` / `ServerResponse` / `ConnectionRpcResult`）复现——逐字段对齐，并有 `tests/unit/web-rpc.test.ts` 钉住形状。这属于复用既有架构，不属于新建远端协议。

### 6.3 卡片状态需要主动拉取

宿主不向浏览器推送任何运行时事实（是否挂载、队列深度、已投递计数）。因此卡片在挂载时读一次，并在挂载期间以 5 秒周期轮询。实现过程中发现初版只在控制器构造时读一次，导致状态条停留在"打开设置面板的那一刻"；该缺陷已修复并有实测依据（保存后队列计数即时刷新）。

---

## 7. 本次未执行的操作

- 未新增、修改或删除 DSH 上游仓库的任何文件；未 fork DSH 核心。
- 未在任何日志、响应或文件中写入 SMTP 口令；`settings.yaml` 的 `dsh-mail-notify` 段只含**引用名** `DSH_MAIL_SMTP_PASSWORD`，不含口令字面值。
- 未执行 `npm publish`、未推送 tag、未创建 GitHub Release。
- 未改动 `cordis.patch.yml` 的语义；既有 patch 配置继续作为组合层生效，未被自动迁移。

---

## 8. 证据附录

权威文件：

- `…\@deepseek-ai\dsh-client-ui-settings-plugins\lib\types\client\slot-contract.d.ts`（`settings.plugin.item` 契约）
- `…\@deepseek-ai\dsh-client-ui-settings-plugins\lib\client.js`（声明链 `:1773-1784`、派发 `:416`、`served` 过滤 `:1144-1145`）
- `…\@deepseek-ai\dsh-client-connection\lib\index.js`（`register` `:602-619`、`registerInterceptor` `:620-633`、`createSharedFetchHandler` `:570-586`、`/api` 路由 `:758-777`）
- `…\@deepseek-ai\dsh-client-modules\lib\client.js`（`makeRequire` `:300-309`、`arriveGraphRow` `:253-270`）
- `…\@deepseek-ai\dsh-session\lib\types\types.d.ts`（`SessionEventMap` 13 种事件；`tool/call` = `{turn, step, callId, name, arguments}`）
- `…\@deepseek-ai\dsh-session\lib\types\index.d.ts:62`（`'session/event'(this, session, event)`）
- `…\@deepseek-ai\dsh-settings\lib\types\index.d.ts`（`register` / `installSection` / `describe` / `mutate`、`SettingsSectionHooks`）
- `…\@deepseek-ai\dsh-api-settings-controller\lib\typert.remote-client.d.ts`、`lib\types\credentials.d.ts`（凭据面只写）
- `…\dsh-web-frontend\dist\assets\index-BKQ_L1z6.js`（9 项种子模块表）
- `CLIENT_RUNTIME_RESOLUTION.md`（本仓库，完整解析图）

---

## 9. 需要用户裁定的问题

**无。** 原 §9 请求裁定"接受方案 B 的入口位置还是坚持上游改动"，本轮已收到明确决策——接受零上游改动的 `settings.plugin.item` 路径——并已据此实施与验证。
