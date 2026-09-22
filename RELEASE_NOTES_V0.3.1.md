# Release notes — v0.3.1

## What this release adds

This release addresses two primary usability defects in the DSH Web configuration surface without modifying the underlying notification runtime, SMTP transport, or credential security model:

1. **Collapsible settings card.** The `dsh-mail-notify` settings card in `Settings → Plugins → Plugin configuration` now starts **collapsed** by default, occupying approximately one compact settings card high (~50–60px) so operators can access other DSH settings without excessive scrolling.
2. **Simplified Chinese localization.** Complete Simplified Chinese (`zh-CN` / `zh`) localization alongside English (`en`), integrating directly with DSH 0.1.5-rc.2's `ctx.locale` service. Locale updates apply live across mounted components without page reloads, and unknown locales gracefully fall back to English.

---

## 1. Collapsible Settings Card (Defect A)

In v0.3.0, the configuration card rendered all field sections in expanded mode at all times, pushing other plugins and general settings far down the viewport.

In v0.3.1:
- **Default collapsed state.** When entering the Plugins tab, the card opens in compact mode.
- **Accessible disclosure header.** The header is rendered as an accessible semantic `<button>` control supporting pointer/touch clicks, keyboard <kbd>Enter</kbd>, and keyboard <kbd>Space</kbd> activation, with standard focus visibility, `aria-expanded`, and `aria-controls`.
- **Safe compact summary.** In collapsed mode, the card displays safe, non-sensitive runtime facts:
  - English: `Active · SMTP configured · Questions on` (or inactive / unconfigured variants)
  - Chinese: `运行中 · SMTP 已配置 · 提问通知已启用` (or inactive / unconfigured variants)
  - Passwords, recipient email addresses, user prompts, and question contents are never exposed in the summary.
- **Draft and async operation retention.** Collapsing and re-expanding the card preserves all staged configuration edits, uncommitted password drafts, save notices, in-flight operations, and test-email delivery results without destroying or reinitializing the controller.
- **Isolation.** Interacting with form inputs or buttons inside the expanded section does not toggle parent disclosure.

---

## 2. Complete English and Simplified Chinese Localization (Defect B)

Every plugin-authored visible string in the Web configuration card is governed by a centralized, typed vocabulary dictionary (`src/client/l10n.ts`):

- **100% key parity.** The English (`en`) and Simplified Chinese (`zh`) dictionaries share an identical, typed set of keys.
- **DSH locale integration.** Consumes the authoritative DSH 0.1.5-rc.2 browser locale runtime (`ctx.locale`). When the active locale changes, mounted components receive the update immediately via external store subscriptions and re-render without reloading.
- **Standard fallback.** If the active locale is unrecognized or unsupported, the UI automatically falls back to English.
- **Localized validation and feedback.** Input validation errors (boolean, integer bounds, email formatting) and operational feedback messages (saving, saved, test email sent, reset staged, password cleared) are fully localized.
- **Canonical terms.** Industry-standard acronyms and terms—`DSH`, `SMTP`, `TLS`, and `STARTTLS`—remain canonical across all languages.

### Vocabulary Reference Table

| English | Simplified Chinese | Context |
| --- | --- | --- |
| Mail notifications | 邮件通知 | Card title |
| Configure email notifications | 配置邮件通知 | Subtitle / description |
| Active / Inactive | 运行中 / 未运行 | Plugin runtime status |
| SMTP configured / SMTP not configured | SMTP 已配置 / SMTP 未配置 | SMTP configuration status |
| Questions on / Questions off | 提问通知已启用 / 提问通知已关闭 | Human-attention question status |
| Expand / Collapse | 展开 / 折叠 | Disclosure button accessible label |
| General | 常规 | Section heading |
| Notifications | 通知类型 | Section heading |
| Questions requiring input | 需要用户回答 | Human-attention prompt |
| Approval requests | 需要用户批准 | Human-attention prompt |
| SMTP | SMTP | Section heading |
| Credential | 凭据 | Section heading |
| Message content | 邮件内容 | Section heading |
| Delivery | 发送与重试 | Section heading |
| Status | 状态 | Status strip heading |
| Enable mail notifications | 启用邮件通知 | Field label |
| Include subagent activity | 包含子智能体活动 | Field label |
| Completed turns | 任务完成 | Field label |
| Errors | 任务错误 | Field label |
| Token-limit termination | 达到 Token 上限 | Field label |
| SMTP host | SMTP 服务器 | Field label |
| Port | 端口 | Field label |
| Implicit TLS | 隐式 TLS | Field label |
| Username | 用户名 | Field label |
| Password | 密码 | Field label |
| From | 发件人 | Field label |
| Recipients | 收件人 | Field label |
| Include metadata | 包含元数据 | Field label |
| Include user prompt | 包含用户提示词 | Field label |
| Include footer | 包含邮件页脚 | Field label |
| Maximum body length | 最大正文长度 | Field label |
| Queue size | 队列大小 | Field label |
| Retry attempts | 重试次数 | Field label |
| Retry base delay | 重试基础延迟 | Field label |
| Dedupe cache size | 去重缓存大小 | Field label |
| Send test email | 发送测试邮件 | Action button |
| Sending… | 正在发送… | In-flight action |
| Test email sent | 测试邮件已发送 | Action outcome |
| Reset | 恢复继承值 | Reset button |
| Discard | 放弃修改 | Discard button |
| Save | 保存 | Save button |
| Saving… | 正在保存… | In-flight action |
| Saved | 已保存 | Save confirmation |

---

## 3. Preserved v0.3.0 Behaviors and Contracts

- **Configuration precedence unchanged:** `schema defaults → cordis.patch.yml (composition) → settings.yaml (user overrides) → effective runtime`.
- **Write-only credentials:** The browser never reads back the stored SMTP password.
- **Attention switches off by default:** `notifyQuestions` and `notifyApprovals` remain disabled by default for privacy.
- **Production delivery test:** "Send test email" continues through the production credential resolution, transport construction, and error classification paths.
- **Zero upstream DSH modifications:** Built against verified `@deepseek-ai/dsh@0.1.5-rc.2`.
