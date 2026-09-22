/**
 * The `dsh-mail-notify` configuration card.
 *
 * Rendered inside Settings → Plugins → Plugin configuration, one card among the
 * deployment's plugin cards. The card owns every part of its own surface —
 * chrome, controls, and copy — because the tab that dispatches it knows only
 * the settings namespace it is keyed by.
 *
 * The card starts collapsed by default to avoid occupying excessive vertical
 * space in Settings. In collapsed mode, it exposes an accessible semantic header
 * button presenting title, chevron, and safe summary facts. When expanded,
 * it reveals the full configuration form.
 *
 * All visible strings use a centralized typed vocabulary supporting English
 * and Simplified Chinese, updating live when DSH locale changes.
 *
 * Implemented using standard React.createElement so it can be verified directly
 * under Node's native TypeScript test runner without JSX pre-transformation.
 *
 * @module dsh-mail-notify/client/Card
 */

import React, { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { CardState, FieldState, MailNotifyCard, MailNotifyCardFace } from './controller.ts'
import {
  CREDENTIAL_REF_FIELD,
  DELIVERY_FIELDS,
  GENERAL_FIELDS,
  MESSAGE_FIELDS,
  NOTIFICATION_FIELDS,
  SMTP_FIELDS,
  type FieldDef,
} from './fields.ts'

const h = React.createElement

/** The two switches the card renders as its own block. */
const PRIVACY_FIELDS = NOTIFICATION_FIELDS.filter((def) => def.privacy === true)

/**
 * How often the card re-reads the host's live facts while it is on screen.
 */
const STATUS_POLL_MS = 5000

/** The notification switches rendered under the privacy block. */
const ORDINARY_NOTIFICATION_FIELDS = NOTIFICATION_FIELDS.filter((def) => def.privacy !== true)

const COLORS = {
  border: 'var(--dsh-border, rgba(127,127,127,0.28))',
  muted: 'var(--dsh-text-muted, rgba(127,127,127,1))',
  warn: 'var(--dsh-warning, #b8860b)',
  bad: 'var(--dsh-danger, #c0392b)',
  good: 'var(--dsh-success, #2e7d32)',
} as const

/**
 * Subscribe one component to the controller's projection.
 *
 * @param card - the controller.
 * @returns the current projection, re-read on every published change.
 */
function useCardState(card: MailNotifyCard): CardState {
  const subscribe = useCallback((listener: () => void) => card.subscribe(listener), [card])
  const read = useCallback(() => card.getSnapshot(), [card])
  return useSyncExternalStore(subscribe, read, read)
}

/** The card's outer frame. */
const FRAME: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: '14px 16px',
  margin: '10px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const ROW: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
const HINT: CSSProperties = { color: COLORS.muted, fontSize: 12, lineHeight: 1.4 }
const GROUP: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const GROUP_TITLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: COLORS.muted,
}
const INPUT: CSSProperties = {
  padding: '4px 6px',
  borderRadius: 4,
  border: `1px solid ${COLORS.border}`,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  maxWidth: 420,
}

const HEADER_BUTTON: CSSProperties = {
  appearance: 'none',
  width: '100%',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  background: 'transparent',
  border: 0,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

/** One field's control, chosen by the field's declared kind. */
function FieldControl(props: {
  card: MailNotifyCard
  def: FieldDef
  state: FieldState
  disabled: boolean
  onChange: (text: string) => void
  onReset: () => void
}): ReactElement {
  const { card, def, state, disabled, onChange, onReset } = props
  const label = def.labelKey ? card.t(def.labelKey) : def.label
  const hint = def.hintKey ? card.t(def.hintKey) : def.hint

  return h(
    'div',
    { style: ROW },
    h(
      'label',
      { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { minWidth: 220 } }, label),
      def.kind === 'boolean'
        ? h(
            'select',
            {
              style: { ...INPUT, maxWidth: 140 },
              value: state.text,
              disabled,
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                onChange(event.target.value)
              },
            },
            h('option', { value: '' }, card.t('optionInherit')),
            h('option', { value: 'true' }, card.t('optionOn')),
            h('option', { value: 'false' }, card.t('optionOff')),
          )
        : h('input', {
            style: INPUT,
            type: 'text',
            inputMode: def.kind === 'natural' ? 'numeric' : 'text',
            value: state.text,
            disabled,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              onChange(event.target.value)
            },
          }),
      state.overridden
        ? h(
            'button',
            {
              type: 'button',
              disabled,
              onClick: onReset,
              style: { ...INPUT, maxWidth: 'none', cursor: 'pointer' },
              title: card.t('resetFieldTitle'),
            },
            card.t('buttonReset'),
          )
        : h('span', { style: HINT }, card.t('badgeInherited')),
    ),
    h('span', { style: HINT }, hint),
    state.invalid ? h('span', { style: { ...HINT, color: COLORS.bad } }, card.t('invalidFieldHint')) : null,
  )
}

/** Render a titled group of fields. */
function FieldGroup(props: {
  card: MailNotifyCard
  title: string
  fields: readonly FieldDef[]
  state: CardState
  onChange: (field: string, text: string) => void
  onReset: (field: string) => void
}): ReactElement {
  const { card, title, fields, state, onChange, onReset } = props
  const disabled = state.saving || !state.writable
  const byName = new Map(state.fields.map((entry) => [entry.def.field, entry]))

  const controls = fields
    .map((def) => {
      const field = byName.get(def.field)
      if (field === undefined) return null
      return h(FieldControl, {
        key: def.field,
        card,
        def,
        state: field,
        disabled,
        onChange: (text) => onChange(def.field, text),
        onReset: () => onReset(def.field),
      })
    })
    .filter(Boolean)

  return h('div', { style: GROUP }, h('span', { style: GROUP_TITLE }, title), ...controls)
}

/** The live status strip. */
function StatusStrip(props: { card: MailNotifyCard; state: CardState }): ReactElement {
  const { card, state } = props
  const status = state.status

  const effective = (field: string): string => {
    const found = state.fields.find((entry) => entry.def.field === field)
    if (found === undefined) return card.t('statusPluginUnknown')
    if (found.text === 'true') return card.t('optionOn')
    if (found.text === 'false') return card.t('optionOff')
    return card.t('optionInherit')
  }

  const bits: ReactNode[] = [
    h(
      'span',
      { key: 'active', style: { color: status?.active === true ? COLORS.good : COLORS.muted } },
      status === undefined
        ? card.t('statusPluginUnknown')
        : status.active
          ? card.t('statusPluginActive')
          : card.t('statusPluginNotRunning'),
    ),
    h(
      'span',
      { key: 'cred', style: { color: state.secret.configured ? COLORS.good : COLORS.warn } },
      state.secret.known
        ? state.secret.configured
          ? card.t('statusCredConfigured')
          : card.t('statusCredMissing')
        : card.t('statusCredUnknown'),
    ),
  ]

  if (status?.queue !== undefined) {
    bits.push(
      h(
        'span',
        { key: 'queue' },
        card.t('statusQueue', {
          depth: status.queue.depth,
          size: status.queue.size,
          delivered: status.queue.delivered,
          failed: status.queue.failed,
        }),
      ),
    )
  }

  return h(
    'div',
    { style: GROUP },
    h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 } }, ...bits),
    h(
      'div',
      { style: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, fontWeight: 600 } },
      h('span', null, card.t('effectiveQuestions', { status: effective('notifyQuestions') })),
      h('span', null, card.t('effectiveApprovals', { status: effective('notifyApprovals') })),
    ),
    status?.configError !== undefined
      ? h('span', { style: { ...HINT, color: COLORS.bad } }, card.t('configErrorNotice', { error: status.configError }))
      : null,
  )
}

/** The write-only credential control. */
function SecretControl(props: {
  card: MailNotifyCard
  state: CardState
  onChange: (text: string) => void
  onClear: () => void
}): ReactElement {
  const { card, state, onChange, onClear } = props
  const disabled = state.saving || !state.writable

  return h(
    'div',
    { style: ROW },
    h(
      'label',
      { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { minWidth: 220 } }, card.t('passwordLabel')),
      h('input', {
        style: INPUT,
        type: 'password',
        autoComplete: 'new-password',
        placeholder: card.t('passwordPlaceholder'),
        value: state.secret.draft,
        disabled: disabled || !state.secret.writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.value)
        },
      }),
      h(
        'button',
        {
          type: 'button',
          disabled: disabled || !state.secret.writable,
          onClick: onClear,
          style: { ...INPUT, maxWidth: 'none', cursor: 'pointer' },
          title: card.t('clearPasswordTitle'),
        },
        card.t('clearStoredPassword'),
      ),
    ),
    h(
      'span',
      { style: HINT },
      state.secret.configured ? card.t('passwordConfiguredHint') : card.t('passwordEmptyHint'),
    ),
  )
}

/**
 * Render one plugin configuration card.
 *
 * Returns nothing while the host does not serve the namespace: a deployment
 * that does not compose this plugin should show no trace of it, rather than a
 * disabled card the user cannot act on.
 *
 * @param props - the injected controller face.
 * @returns the card, or `null` while the namespace is unavailable.
 */
export function MailNotifyCardView(props: MailNotifyCardFace): ReactElement | null {
  const card = props.card
  const state = useCardState(card)
  const [expanded, setExpanded] = useState(false)
  const disclosureId = useId()

  useEffect(() => {
    void card.refresh()
    const timer = setInterval(() => {
      void card.refresh()
    }, STATUS_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [card])

  if (!state.available) return null

  const disabled = state.saving || !state.writable
  const onChange = (field: string, text: string): void => {
    card.edit(field, text)
  }
  const onReset = (field: string): void => {
    card.resetField(field)
  }

  // Safe collapsed summary facts
  const activeLabel = state.status?.active ? card.t('active') : card.t('inactive')
  const smtpLabel = state.status?.smtpConfigured ? card.t('smtpConfigured') : card.t('smtpNotConfigured')
  const questionsField = state.fields.find((entry) => entry.def.field === 'notifyQuestions')
  const questionsOn = questionsField?.text === 'true'
  const questionsLabel = questionsOn ? card.t('questionsOn') : card.t('questionsOff')
  const summaryLine = `${activeLabel} · ${smtpLabel} · ${questionsLabel}`

  const humanAttentionControls = PRIVACY_FIELDS.map((def) => {
    const field = state.fields.find((entry) => entry.def.field === def.field)
    if (field === undefined) return null
    return h(FieldControl, {
      key: def.field,
      card,
      def,
      state: field,
      disabled,
      onChange: (text) => onChange(def.field, text),
      onReset: () => onReset(def.field),
    })
  }).filter(Boolean)

  return h(
    'section',
    { style: FRAME, 'aria-label': card.t('title') },
    h(
      'button',
      {
        type: 'button',
        style: HEADER_BUTTON,
        'aria-expanded': expanded,
        'aria-controls': disclosureId,
        'aria-label': `${card.t(expanded ? 'collapse' : 'expand')}: ${card.t('title')}`,
        onClick: () => {
          setExpanded(!expanded)
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 } },
        h('strong', { style: { fontSize: 15, color: 'inherit' } }, card.t('title')),
        h('span', { style: HINT }, expanded ? card.t('description') : summaryLine),
      ),
      h(
        'span',
        {
          'aria-hidden': 'true',
          style: {
            color: COLORS.muted,
            fontSize: 14,
            userSelect: 'none',
            flex: 'none',
            padding: '0 4px',
          },
        },
        expanded ? '▾' : '▸',
      ),
    ),
    expanded
      ? h(
          'div',
          { id: disclosureId, style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h('span', { style: HINT }, card.t('headerHint')),
          h(StatusStrip, { card, state }),
          h(
            'div',
            { style: { ...GROUP, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '10px 12px' } },
            h('span', { style: { ...GROUP_TITLE, color: 'inherit' } }, card.t('groupHumanAttention')),
            h('span', { style: HINT }, card.t('humanAttentionHint')),
            ...humanAttentionControls,
          ),
          h(FieldGroup, {
            card,
            title: card.t('groupGeneral'),
            fields: GENERAL_FIELDS,
            state,
            onChange,
            onReset,
          }),
          h(FieldGroup, {
            card,
            title: card.t('groupNotifications'),
            fields: ORDINARY_NOTIFICATION_FIELDS,
            state,
            onChange,
            onReset,
          }),
          h(FieldGroup, {
            card,
            title: card.t('groupSmtp'),
            fields: SMTP_FIELDS,
            state,
            onChange,
            onReset,
          }),
          h(SecretControl, {
            card,
            state,
            onChange: (text) => card.setSecretDraft(text),
            onClear: () => void card.clearCredential(),
          }),
          h(FieldGroup, {
            card,
            title: card.t('groupCredential'),
            fields: [CREDENTIAL_REF_FIELD],
            state,
            onChange,
            onReset,
          }),
          h(FieldGroup, {
            card,
            title: card.t('groupMessage'),
            fields: MESSAGE_FIELDS,
            state,
            onChange,
            onReset,
          }),
          h(FieldGroup, {
            card,
            title: card.t('groupDelivery'),
            fields: DELIVERY_FIELDS,
            state,
            onChange,
            onReset,
          }),
          state.testEmail !== undefined
            ? h(
                'span',
                { style: { ...HINT, color: state.testEmail.delivered ? COLORS.good : COLORS.bad } },
                state.testEmail.message,
              )
            : null,
          state.notice !== undefined ? h('span', { style: HINT }, state.notice) : null,
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h(
              'button',
              {
                type: 'button',
                disabled: disabled || state.testing,
                onClick: () => void card.sendTestEmail(),
                style: { ...INPUT, maxWidth: 'none', cursor: 'pointer' },
              },
              state.testing ? card.t('sending') : card.t('sendTestEmail'),
            ),
            h(
              'button',
              {
                type: 'button',
                disabled,
                onClick: () => card.resetAll(),
                style: { ...INPUT, maxWidth: 'none', cursor: 'pointer' },
                title: card.t('resetAllTitle'),
              },
              card.t('resetAll'),
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: disabled || !state.dirty,
                onClick: () => card.discard(),
                style: { ...INPUT, maxWidth: 'none', cursor: 'pointer' },
              },
              card.t('discard'),
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: disabled || !state.dirty || state.invalid,
                onClick: () => void card.save(),
                style: { ...INPUT, maxWidth: 'none', cursor: 'pointer', fontWeight: 600 },
              },
              state.saving ? card.t('saving') : card.t('save'),
            ),
          ),
        )
      : null,
  )
}
