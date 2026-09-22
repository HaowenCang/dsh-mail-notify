/**
 * The `dsh-mail-notify` configuration card.
 *
 * Rendered inside Settings → Plugins → Plugin configuration, one card among the
 * deployment's plugin cards. The card owns every part of its own surface —
 * chrome, controls, and copy — because the tab that dispatches it knows only
 * the settings namespace it is keyed by.
 *
 * The whole card is a disclosure, collapsed by default. One plugin's complete
 * configuration form permanently on the page pushes every other settings entry
 * below a long scroll, so the card shows a compact header — its title and a
 * one-line operational summary — and renders the form only while expanded. The
 * expansion state is presentation state: it lives in this component and is
 * never persisted, and collapsing unmounts nothing the controller owns, so
 * staged drafts, in-flight saves, and operation results all survive it.
 *
 * Every visible string comes from the framework-injected `t` seat over the
 * `dsh-mail-notify` locale namespace (see `locale.ts`), including operation
 * messages and validation refusals, which the controller stores as semantic
 * identities and this component translates at render. Nothing here branches on
 * a language, and a live DSH locale switch re-renders the whole card — the
 * notice on screen included — in the new language.
 *
 * The two human-attention switches render first inside the form and apart from
 * the rest. They are the switches that decide whether an operator learns that
 * an agent has stopped and is waiting for a person, and both are off by default
 * because turning one on sends content the operator did not author to a
 * third-party mail system. Burying them in an alphabetical list of nine booleans
 * would make the consequential choice the hardest one to find.
 *
 * @module dsh-mail-notify/client/Card
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, JSX } from 'react'
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
import type { MailNotifyTranslate } from './locale.ts'

/**
 * The composed props the slot machinery hands the card: the registrant's own
 * face plus the framework-synthesized locale seat for the declared namespace.
 */
export type MailNotifyCardProps = MailNotifyCardFace & { t: MailNotifyTranslate }

/** The two switches the card renders as its own block. */
const PRIVACY_FIELDS = NOTIFICATION_FIELDS.filter((def) => def.privacy === true)

/**
 * How often the card re-reads the host's live facts while it is on screen.
 *
 * Slow on purpose: these are counters and a queue depth, not a live feed, and a
 * faster poll would put a request on the wire every few seconds without telling
 * the user anything sooner.
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

/** The disclosure region's element id, referenced by the header's `aria-controls`. */
const BODY_ID = 'dsh-mail-notify-config-body'

/**
 * Read one field's draft text — the staged edit when there is one, and the
 * effective value otherwise.
 *
 * @param state - the card projection.
 * @param field - the field name.
 * @returns the control's current text ('' while the field inherits).
 */
function draftOf(state: CardState, field: string): string {
  const found = state.fields.find((entry) => entry.def.field === field)
  return found === undefined ? '' : found.text
}

/**
 * The collapsed summary: one compact line of safe operational facts.
 *
 * Deliberately narrow — runtime state, SMTP readiness, and the question
 * switch's effective state. No address, no username, no draft, and nothing the
 * credential carries: the summary is the one part of the card readable without
 * expanding it, and none of the excluded values is safe to leave on a screen
 * someone walked away from.
 *
 * @param state - the card projection.
 * @param t - the locale seat.
 * @returns the summary line.
 */
function summaryOf(state: CardState, t: MailNotifyTranslate): string {
  const segments: string[] = []
  segments.push(
    state.status === undefined
      ? t('factUnknown')
      : state.status.active
        ? t('summaryActive')
        : t('summaryInactive'),
  )
  segments.push(state.status?.smtpConfigured ? t('summarySmtpConfigured') : t('summarySmtpMissing'))
  segments.push(draftOf(state, 'notifyQuestions') === 'true' ? t('summaryQuestionsOn') : t('summaryQuestionsOff'))
  if (state.saving || state.testing) segments.push(t('summaryBusy'))
  return segments.join(' · ')
}

/**
 * Resolve a hint's term params through the locale seat.
 *
 * @param def - the field definition.
 * @param t - the locale seat.
 * @returns the template params, or `undefined` for a hint without terms.
 */
function hintParams(def: FieldDef, t: MailNotifyTranslate): Record<string, unknown> | undefined {
  if (def.hintTerms === undefined) return undefined
  const terms: Record<string, unknown> = {}
  for (const [name, key] of Object.entries(def.hintTerms)) terms[name] = t(key)
  return terms
}

/** The card's outer frame. */
const FRAME: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: '14px 16px',
  margin: '10px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const ROW: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
const HINT: CSSProperties = { color: COLORS.muted, fontSize: 12, lineHeight: 1.4 }
const GROUP: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const FORM: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
/**
 * The disclosure header: one native button across the card's width.
 *
 * The browser's own button styling is kept — in particular the focus ring is
 * never suppressed, which is what makes the control's focus visible.
 */
const DISCLOSURE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '2px 4px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}
const CHEVRON: CSSProperties = { width: 12, flex: '0 0 auto', color: COLORS.muted }
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

/** One field's control, chosen by the field's declared kind. */
function FieldControl(props: {
  def: FieldDef
  state: FieldState
  disabled: boolean
  t: MailNotifyTranslate
  onChange: (text: string) => void
  onReset: () => void
}): JSX.Element {
  const { def, state, disabled, t, onChange, onReset } = props
  return (
    <div style={ROW}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ minWidth: 220 }}>{t(def.labelKey)}</span>
        {def.kind === 'boolean' ? (
          <select
            style={{ ...INPUT, maxWidth: 140 }}
            name={def.field}
            value={state.text}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value)
            }}
          >
            {/* The empty draft is a staged clear: saving removes the override and
                the field goes back to the composition layer and schema default.
                It is a distinct choice from "false", and a checkbox could not
                express it. */}
            <option value="">{t('optionInherit')}</option>
            <option value="true">{t('factOn')}</option>
            <option value="false">{t('factOff')}</option>
          </select>
        ) : (
          <input
            style={INPUT}
            type="text"
            name={def.field}
            inputMode={def.kind === 'natural' ? 'numeric' : 'text'}
            value={state.text}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value)
            }}
          />
        )}
        {state.overridden ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onReset}
            style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
            title={t('resetFieldTitle')}
            data-action="reset-field"
            data-field={def.field}
          >
            {t('actionReset')}
          </button>
        ) : (
          <span style={HINT}>{t('inheritedBadge')}</span>
        )}
      </label>
      <span style={HINT}>{t(def.hintKey, hintParams(def, t))}</span>
      {state.invalid ? (
        <span data-field-invalid={def.field} style={{ ...HINT, color: COLORS.bad }}>
          {state.issue === undefined
            ? t('invalidBlocksSave')
            : `${t(state.issue.key, { field: t(def.labelKey), ...state.issue.params })} ${t('invalidBlocksSave')}`}
        </span>
      ) : null}
    </div>
  )
}

/** Render a titled group of fields. */
function FieldGroup(props: {
  title: string
  fields: readonly FieldDef[]
  state: CardState
  t: MailNotifyTranslate
  onChange: (field: string, text: string) => void
  onReset: (field: string) => void
}): JSX.Element {
  const disabled = props.state.saving || !props.state.writable
  const byName = new Map(props.state.fields.map((entry) => [entry.def.field, entry]))
  return (
    <div style={GROUP}>
      <span style={GROUP_TITLE}>{props.title}</span>
      {props.fields.map((def) => {
        const field = byName.get(def.field)
        if (field === undefined) return null
        return (
          <FieldControl
            key={def.field}
            def={def}
            state={field}
            disabled={disabled}
            t={props.t}
            onChange={(text) => {
              props.onChange(def.field, text)
            }}
            onReset={() => {
              props.onReset(def.field)
            }}
          />
        )
      })}
    </div>
  )
}

/** The live status strip. */
function StatusStrip(props: { state: CardState; t: MailNotifyTranslate }): JSX.Element {
  const { state, t } = props
  const status = state.status
  const effective = (field: string): string => {
    const found = state.fields.find((entry) => entry.def.field === field)
    if (found === undefined) return t('factUnknown')
    if (found.text === 'true') return t('factOn')
    if (found.text === 'false') return t('factOff')
    return t('optionInherit')
  }
  const bits: JSX.Element[] = []
  bits.push(
    <span key="active" style={{ color: status?.active === true ? COLORS.good : COLORS.muted }}>
      {t('statusPlugin', {
        state:
          status === undefined ? t('factUnknown') : status.active ? t('factActive') : t('factInactive'),
      })}
    </span>,
  )
  bits.push(
    <span key="cred" style={{ color: state.secret.configured ? COLORS.good : COLORS.warn }}>
      {t('statusCredential', {
        state: state.secret.known
          ? state.secret.configured
            ? t('factConfigured')
            : t('factNotConfigured')
          : t('factUnknown'),
      })}
    </span>,
  )
  if (status?.queue !== undefined) {
    bits.push(
      <span key="queue">
        {t('statusQueue', {
          depth: status.queue.depth,
          size: status.queue.size,
          delivered: status.queue.delivered,
          failed: status.queue.failed,
        })}
      </span>,
    )
  }
  return (
    <div style={GROUP}>
      <span style={GROUP_TITLE}>{t('groupStatus')}</span>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>{bits}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, fontWeight: 600 }}>
        <span>{t('statusEffectiveQuestions', { value: effective('notifyQuestions') })}</span>
        <span>{t('statusEffectiveApprovals', { value: effective('notifyApprovals') })}</span>
      </div>
      {status?.configError === undefined ? null : (
        <span style={{ ...HINT, color: COLORS.bad }}>{t('statusConfigError', { message: status.configError })}</span>
      )}
    </div>
  )
}

/** The write-only credential control. */
function SecretControl(props: {
  state: CardState
  t: MailNotifyTranslate
  onChange: (text: string) => void
  onClear: () => void
}): JSX.Element {
  const { state, t, onChange, onClear } = props
  const disabled = state.saving || !state.writable
  return (
    <div style={ROW}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ minWidth: 220 }}>{t(state.secret.configured ? 'passwordChange' : 'passwordSet')}</span>
        <input
          style={INPUT}
          type="password"
          name="smtpPasswordSecret"
          autoComplete="new-password"
          aria-label={t('labelSecret')}
          placeholder={t(state.secret.configured ? 'passwordPlaceholderKeep' : 'passwordPlaceholderNew')}
          value={state.secret.draft}
          disabled={disabled || !state.secret.writable}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
        <button
          type="button"
          disabled={disabled || !state.secret.writable}
          onClick={onClear}
          style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
          title={t('passwordClearTitle')}
          data-action="clear-credential"
        >
          {t('passwordClear')}
        </button>
      </label>
      <span style={HINT}>{t(state.secret.configured ? 'hintSecretStored' : 'hintSecretMissing')}</span>
    </div>
  )
}

/**
 * Render one plugin configuration card.
 *
 * Returns nothing while the host does not serve the namespace: a deployment
 * that does not compose this plugin should show no trace of it, rather than a
 * disabled card the user cannot act on.
 *
 * @param props - the injected controller face and the locale seat.
 * @returns the card, or `null` while the namespace is unavailable.
 */
export function MailNotifyCardView(props: MailNotifyCardProps): JSX.Element | null {
  const { card, t } = props
  const state = useCardState(card)
  // Presentation state only: nothing persists the expansion, and collapsing
  // changes what the view renders — never what the controller holds.
  const [expanded, setExpanded] = useState(false)

  // The status strip reads live host facts — whether the runtime is mounted,
  // how deep the queue is, how many messages have gone out — and none of them
  // is pushed to the browser. They are therefore pulled: once when the card
  // appears, and then on a slow poll for as long as it stays mounted. The tab
  // keeps a selected tab mounted, so a one-shot read at mount would leave the
  // strip describing the moment Settings was opened rather than the moment the
  // user is reading it.
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

  return (
    <section style={FRAME} aria-label={t('cardTitle')}>
      <button
        type="button"
        style={DISCLOSURE}
        aria-expanded={expanded}
        aria-controls={BODY_ID}
        title={expanded ? t('actionCollapse') : t('actionExpand')}
        onClick={() => {
          setExpanded((open) => !open)
        }}
      >
        <span aria-hidden="true" style={CHEVRON}>
          {expanded ? '▾' : '▸'}
        </span>
        <strong style={{ fontSize: 15 }}>{t('cardTitle')}</strong>
      </button>
      <p data-summary style={{ ...HINT, margin: 0 }}>
        {summaryOf(state, t)}
      </p>

      <div id={BODY_ID} hidden={!expanded}>
        {expanded ? (
          <div style={FORM}>
            <span style={HINT}>{t('cardSubtitle')}</span>

            <StatusStrip state={state} t={t} />

            <div style={{ ...GROUP, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '10px 12px' }}>
              <span style={{ ...GROUP_TITLE, color: 'inherit' }}>{t('groupAttention')}</span>
              <span style={HINT}>{t('hintAttention')}</span>
              {PRIVACY_FIELDS.map((def) => {
                const field = state.fields.find((entry) => entry.def.field === def.field)
                if (field === undefined) return null
                return (
                  <FieldControl
                    key={def.field}
                    def={def}
                    state={field}
                    disabled={disabled}
                    t={t}
                    onChange={(text) => {
                      onChange(def.field, text)
                    }}
                    onReset={() => {
                      onReset(def.field)
                    }}
                  />
                )
              })}
            </div>

            <FieldGroup
              title={t('groupGeneral')}
              fields={GENERAL_FIELDS}
              state={state}
              t={t}
              onChange={onChange}
              onReset={onReset}
            />
            <FieldGroup
              title={t('groupNotifications')}
              fields={ORDINARY_NOTIFICATION_FIELDS}
              state={state}
              t={t}
              onChange={onChange}
              onReset={onReset}
            />
            <FieldGroup
              title={t('groupSmtp')}
              fields={SMTP_FIELDS}
              state={state}
              t={t}
              onChange={onChange}
              onReset={onReset}
            />
            <SecretControl
              state={state}
              t={t}
              onChange={(text) => {
                card.setSecretDraft(text)
              }}
              onClear={() => {
                void card.clearCredential()
              }}
            />
            <FieldGroup
              title={t('groupCredential')}
              fields={[CREDENTIAL_REF_FIELD]}
              state={state}
              t={t}
              onChange={onChange}
              onReset={onReset}
            />
            <FieldGroup
              title={t('groupMessage')}
              fields={MESSAGE_FIELDS}
              state={state}
              t={t}
              onChange={onChange}
              onReset={onReset}
            />
            <FieldGroup
              title={t('groupDelivery')}
              fields={DELIVERY_FIELDS}
              state={state}
              t={t}
              onChange={onChange}
              onReset={onReset}
            />

            {state.testEmail === undefined ? null : (
              <span
                data-notice="test-email"
                style={{ ...HINT, color: state.testEmail.delivered ? COLORS.good : COLORS.bad }}
              >
                {t(state.testEmail.message.key, state.testEmail.message.params)}
              </span>
            )}
            {state.notice === undefined ? null : (
              <span data-notice="operation" style={HINT}>
                {t(state.notice.key, state.notice.params)}
              </span>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={disabled || state.testing}
                onClick={() => {
                  void card.sendTestEmail()
                }}
                style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
                data-action="send-test"
              >
                {state.testing ? t('actionSending') : t('actionSendTest')}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  card.resetAll()
                }}
                style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
                title={t('actionResetAllTitle')}
                data-action="reset-all"
              >
                {t('actionReset')}
              </button>
              <button
                type="button"
                disabled={disabled || !state.dirty}
                onClick={() => {
                  card.discard()
                }}
                style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
                data-action="discard"
              >
                {t('actionDiscard')}
              </button>
              <button
                type="button"
                disabled={disabled || !state.dirty || state.invalid}
                onClick={() => {
                  void card.save()
                }}
                style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer', fontWeight: 600 }}
                data-action="save"
              >
                {state.saving ? t('actionSaving') : t('actionSave')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
