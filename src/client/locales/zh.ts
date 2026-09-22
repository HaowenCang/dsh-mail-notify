/**
 * Simplified Chinese copy for the `dsh-mail-notify` configuration card.
 *
 * Declared as {@link MailNotifyDictionary}, so this file cannot compile with a
 * key the vocabulary does not declare or without a key it does — exact key
 * parity with `en.ts` is a property of the type, not of review.
 *
 * `DSH`, `SMTP`, `TLS`, and `STARTTLS` stay verbatim in both dictionaries.
 *
 * @module dsh-mail-notify/client/locales/zh
 */

import type { MailNotifyDictionary } from './vocabulary.ts'

/** 简体中文词典。 */
export const zh: MailNotifyDictionary = {
  title: '邮件通知',
  subtitle: '配置邮件通知',
  description: '通过 SMTP 把顶层任务的最终输出、终止性失败，以及任务中途需要人介入的请求发送到邮箱。',

  'summary.expand': '展开',
  'summary.collapse': '折叠',
  'summary.active': '运行中',
  'summary.inactive': '未运行',
  'summary.smtpConfigured': 'SMTP 已配置',
  'summary.smtpMissing': 'SMTP 未配置',
  'summary.questionsOn': '提问通知已启用',
  'summary.questionsOff': '提问通知已关闭',
  'summary.unsaved': '有未保存的修改',

  'value.on': '已启用',
  'value.off': '已关闭',
  'value.inherit': '继承',
  'value.unknown': '未知',
  'value.configured': '已配置',
  'value.notConfigured': '未配置',

  'group.status': '状态',
  'group.general': '常规',
  'group.notifications': '通知类型',
  'group.humanAttention': '提问与批准',
  'group.smtp': 'SMTP',
  'group.credential': '凭据',
  'group.message': '邮件内容',
  'group.delivery': '发送与重试',

  'attention.intro': '这两项是通知存在的理由：智能体已经停下，正在等待人。两者默认关闭。',

  'field.enabled': '启用邮件通知',
  'field.includeSubagents': '包含子智能体活动',
  'field.notifyQuestions': '需要用户回答',
  'field.notifyApprovals': '需要用户批准',
  'field.notifyCompleted': '任务完成',
  'field.notifyErrors': '任务错误',
  'field.notifyMaxTokens': '达到 Token 上限',
  'field.smtpHost': 'SMTP 服务器',
  'field.smtpPort': '端口',
  'field.smtpSecure': '安全连接',
  'field.smtpUser': '用户名',
  'field.from': '发件人',
  'field.to': '收件人',
  'field.credentialRef': '凭据引用名',
  'field.includeMetadata': '包含元数据',
  'field.includeUserPrompt': '包含用户提示词',
  'field.includeFooter': '包含邮件页脚',
  'field.maxBodyChars': '最大正文长度',
  'field.queueSize': '队列大小',
  'field.retryAttempts': '重试次数',
  'field.retryBaseDelayMs': '重试基础延迟',
  'field.maxDedupeEntries': '去重缓存大小',

  'hint.enabled': '关闭时插件不注册任何监听，也不读取任何凭据。',
  'hint.includeSubagents': '除顶层任务外，被委派的子智能体任务是否也发送通知。',
  'hint.notifyQuestions': '当 DSH 正在等待你的回答时立即发送邮件。',
  'hint.notifyApprovals': '当 DSH 正在等待你的批准决定时立即发送邮件。',
  'hint.notifyCompleted': '正常结束的顶层任务。',
  'hint.notifyErrors': '以终止性错误结束的任务，包括没有产生任何可见输出的情况。',
  'hint.notifyMaxTokens': '因为达到 Token 上限而停止的任务。',
  'hint.smtpHost': 'SMTP 服务器的主机名。',
  'hint.smtpPort': 'STARTTLS 通常为 587，隐式 TLS 通常为 465。',
  'hint.smtpSecure': '开启表示隐式 TLS（通常端口 465）；关闭表示允许 STARTTLS 升级（通常端口 587）。',
  'hint.smtpUser': '用于认证的用户名。',
  'hint.from': '信封发件人。部分服务器要求它与已认证账号一致。',
  'hint.to': '一个或多个地址，用逗号或换行分隔。',
  'hint.credentialRef': '密码所读取的凭据名称。这里填写名称，不是密码本身。',
  'hint.includeMetadata': '会话、工作区、模型与耗时。',
  'hint.includeUserPrompt': '默认关闭：提示词可能带有你并不打算邮寄出去的内容。',
  'hint.includeFooter': '生成器页脚与截断标记。',
  'hint.maxBodyChars': '可见文本的最大长度，按码点计数。',
  'hint.queueSize': '等待队列上限；工作线程会额外持有一个。',
  'hint.retryAttempts': '总尝试次数为该值加一。',
  'hint.retryBaseDelayMs': '第 n 次重试等待“基础延迟 × 3^(n−1)”，上限 30 秒。',
  'hint.maxDedupeEntries': '记录多少个最近已通知的事件。',

  'control.reset': '恢复继承值',
  'control.resetTitle': '移除该字段的覆盖值，使它重新继承组合层配置',
  'control.inherited': '继承自组合层',
  'control.invalid': '该值会阻止保存。',
  'control.boolean': '可选项为继承、已启用、已关闭。选择继承会移除覆盖值。',

  'secret.label': '密码',
  'secret.placeholder': '留空表示保留当前密码',
  'secret.set': '设置密码',
  'secret.change': '修改密码',
  'secret.clear': '清除已存密码',
  'secret.clearTitle': '删除该引用名下已存储的值',
  'secret.stored': '该引用名下已存储密码。密码不会下发到浏览器；输入新密码即覆盖旧密码。',
  'secret.absent': '该引用名下尚未存储密码。输入后会直接写入，且永远无法读回。',

  'status.pluginLabel': '插件',
  'status.credentialLabel': '凭据',
  'status.queue': '队列',
  'status.queueDepth': '{depth}/{size} · 已送达 {delivered} · 失败 {failed}',
  'status.effectiveQuestions': '生效中的提问通知',
  'status.effectiveApprovals': '生效中的批准通知',
  'status.configError': '已保存的配置无法生效，因此仍然沿用上一份设置：{reason}',

  'action.sendTest': '发送测试邮件',
  'action.sending': '正在发送…',
  'action.testSent': '测试邮件已发送',
  'action.testRefused': '测试邮件已被拒绝',
  'action.reset': '恢复继承值',
  'action.resetTitle': '移除本插件拥有的全部覆盖值，使组合层配置与 schema 默认值重新生效',
  'action.discard': '放弃修改',
  'action.save': '保存',
  'action.saving': '正在保存…',

  'notice.saved': '已保存',
  'notice.nothingToSave': '没有需要保存的修改。',
  'notice.fixInvalid': '请先修正高亮的字段，然后再保存。',
  'notice.resetStaged': '已暂存重置：保存后所有字段都会回到组合层配置值。',
  'notice.passwordRemoved': '已存储的密码已删除。',
  'notice.saveRefused': '宿主没有接受这次保存。',
  'notice.testAccepted': 'SMTP 服务器已接受该邮件，收件人 {count} 个。',

  'validation.boolean': '{label} 只能取 true 或 false',
  'validation.wholeNumber': '{label} 必须是整数',
  'validation.outOfRange': '{label} 超出可接受范围',
  'validation.atLeast': '{label} 不能小于 {min}',
  'validation.atMost': '{label} 不能大于 {max}',
  'validation.badAddress': '不是可用的邮箱地址：{addresses}',
}
