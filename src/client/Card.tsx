/**
 * The `dsh-mail-notify` configuration card.
 *
 * Rendered inside Settings → Plugins → Plugin configuration, one card among the
 * deployment's plugin cards. The card owns every part of its own surface —
 * chrome, controls, and copy — because the tab that dispatches it knows only
 * the settings namespace it is keyed by.
 *
 * ## The whole card is one disclosure
 *
 * A fourteen-field form rendered open occupies most of a viewport, so every
 * unrelated setting below it costs a scroll. The card therefore renders as a
 * single collapsed summary card by default and reveals the form on demand.
 * DSH's own plugin cards use the same shape — a `button` header carrying
 * `aria-expanded`, with the body mounted only while open — so this card behaves
 * the way the cards around it already do.
 *
 * The disclosure is presentation and nothing else. It is `useState` local to
 * this component: it is not written to `settings.yaml`, not written to the
 * composition patch, not derived from credentials, and not part of the
 * controller's projection. The controller owns every piece of state a collapse
 * could damage — staged drafts, the in-flight save, the last test outcome, the
 * credential draft — and because collapsing does not unmount the controller,
 * none of it is disturbed. The body *is* unmounted while collapsed, and it is
 * rebuilt from the controller on re-expansion, which is exactly why the drafts
 * survive: they were never in the DOM to begin with.
 *
 * ## The summary exposes facts, not content
 *
 * The collapsed header states three safe things: whether the runtime is
 * mounted, whether the effective configuration carries a usable SMTP section,
 * and whether question notifications are on. All three are already public to
 * the browser — the first two are what the status endpoint reports, the third
 * is a boolean in the settings document this card edits. Nothing in the header
 * comes from the credential draft, the recipient list, a question's text, the
 * user's prompt, or any tool argument, and none of those could reach it: the
 * header renders from the same projection the form does, and that projection
 * carries no such value.
 *
 * The two human-attention switches render first and apart from the rest. They
 * are the switches that decide whether an operator learns that an agent has
 * stopped and is waiting for a person, and both are off by default because
 * turning one on sends content the operator did not author to a third-party
 * mail system. Burying them in an alphabetical list of nine booleans would make
 * the consequential choice the hardest one to find.
 *
 * @module dsh-mail-notify/client/Card
 */

import { useCallback, useEffect, useId, useSyncExternalStore, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { CardState, FieldState, MailNotifyCard, MailNotifyCardFace } from './controller.ts'
import { composeValidation, type FieldDef, type ValidationReason } from './fields.ts'
import { compose } from './message.ts'
import type { MailNotifyTranslate } from './locales/index.ts'
import {
  CREDENTIAL_REF_FIELD,
  DELIVERY_FIELDS,
  GENERAL_FIELDS,
  MESSAGE_FIELDS,
  NOTIFICATION_FIELDS,
  SMTP_FIELDS,
} from './fields.ts'

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
  focus: 'var(--dsh-focus, #4c8dff)',
} as const

/**
 * Marker attribute for the disclosure's focus rule.
 *
 * The card styles itself inline, which cannot express `:focus-visible`. Rather
 * than pull a stylesheet into the bundle for one rule, the card ships one
 * `<style>` element holding exactly that rule, keyed by this attribute and
 * emitted once per document no matter how many cards mount.
 */
const FOCUS_STYLE_ID = 'dsh-mail-notify-card-focus'
const FOCUS_STYLE = `.dsh-mail-notify-disclosure:focus-visible{outline:2px solid ${COLORS.focus};outline-offset:2px;border-radius:8px}`

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

/** Install the focus rule once per document. */
function FocusRule(): null {
  useEffect(() => {
    if (document.getElementById(FOCUS_STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = FOCUS_STYLE_ID
    style.textContent = FOCUS_STYLE
    document.head.appendChild(style)
  }, [])
  return null
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

/**
 * The collapsed card's padding.
 *
 * Smaller than {@link FRAME} in the vertical axis on purpose: the whole point
 * of the disclosure is that a collapsed card costs about one line of vertical
 * space, and the expanded card's breathing room is not needed around a single
 * header row.
 */
const FRAME_COLLAPSED: CSSProperties = { ...FRAME, padding: '10px 16px', gap: 0 }

const HEADER_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
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

/**
 * Render one field's refusal in the active locale.
 *
 * @param t - the live translate function.
 * @param reason - the refusal recorded by `parseField`.
 * @returns the refusal sentence.
 */
function validationText(t: MailNotifyTranslate, reason: ValidationReason): string {
  return composeValidation((key, params) => t(key, params), reason)
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
            value={state.text}
            disabled={disabled}
            title={t('control.boolean')}
            onChange={(event) => {
              onChange(event.target.value)
            }}
          >
            {/* The empty draft is a staged clear: saving removes the override and
                the field goes back to the composition layer and schema default.
                It is a distinct choice from "false", and a checkbox could not
                express it. */}
            <option value="">{t('value.inherit')}</option>
            <option value="true">{t('value.on')}</option>
            <option value="false">{t('value.off')}</option>
          </select>
        ) : (
          <input
            style={INPUT}
            type="text"
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
            title={t('control.resetTitle')}
          >
            {t('control.reset')}
          </button>
        ) : (
          <span style={HINT}>{t('control.inherited')}</span>
        )}
      </label>
      <span style={HINT}>{t(def.hintKey)}</span>
      {state.invalid && state.reason !== undefined ? (
        <span style={{ ...HINT, color: COLORS.bad }}>{validationText(t, state.reason)}</span>
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
      {props.title === '' ? null : <span style={GROUP_TITLE}>{props.title}</span>}
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
    if (found === undefined) return t('value.unknown')
    if (found.text === 'true') return t('value.on')
    if (found.text === 'false') return t('value.off')
    return t('value.inherit')
  }
  const bits: JSX.Element[] = []
  bits.push(
    <span key="active" style={{ color: status?.active === true ? COLORS.good : COLORS.muted }}>
      {t('status.pluginLabel')} {status === undefined ? t('value.unknown') : status.active ? t('summary.active') : t('summary.inactive')}
    </span>,
  )
  bits.push(
    <span key="cred" style={{ color: state.secret.configured ? COLORS.good : COLORS.warn }}>
      {t('status.credentialLabel')}{' '}
      {state.secret.known ? (state.secret.configured ? t('value.configured') : t('value.notConfigured')) : t('value.unknown')}
    </span>,
  )
  if (status?.queue !== undefined) {
    bits.push(
      <span key="queue">
        {t('status.queue')}{' '}
        {t('status.queueDepth', {
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
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>{bits}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, fontWeight: 600 }}>
        <span>
          {t('status.effectiveQuestions')}: {effective('notifyQuestions')}
        </span>
        <span>
          {t('status.effectiveApprovals')}: {effective('notifyApprovals')}
        </span>
      </div>
      {status?.configError === undefined ? null : (
        <span style={{ ...HINT, color: COLORS.bad }}>
          {t('status.configError', { reason: status.configError })}
        </span>
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
        <span style={{ minWidth: 220 }}>
          {/* The wording tracks what the reference currently holds, because the
              gesture means two different things: setting a password where none
              is stored, or replacing one that is. The write itself is v0.3.0's
              and is unchanged. */}
          {t(state.secret.configured ? 'secret.change' : 'secret.set')}
        </span>
        <input
          style={INPUT}
          type="password"
          autoComplete="new-password"
          placeholder={t('secret.placeholder')}
          value={state.secret.draft}
          disabled={disabled || !state.secret.writable}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
        {state.secret.configured ? (
          // The removal is separate from the write on purpose: typing a new
          // password must not be the only way to reach the clear, and clearing
          // must not be what the primary control does when the user is trying
          // to replace a password.
          <button
            type="button"
            disabled={disabled || !state.secret.writable}
            onClick={onClear}
            style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
            title={t('secret.clearTitle')}
          >
            {t('secret.clear')}
          </button>
        ) : null}
      </label>
      <span style={HINT}>{state.secret.configured ? t('secret.stored') : t('secret.absent')}</span>
    </div>
  )
}

/**
 * The collapsed card's one-line summary.
 *
 * Three facts, each of which the browser already holds and none of which is
 * content: whether the runtime is mounted, whether a usable SMTP section is in
 * effect, and whether question notifications are on. Derived from the same
 * projection the form renders, so it cannot describe anything the form does not
 * also show.
 *
 * @param props - the projection and the live translate function.
 * @returns the summary line.
 */
function SummaryLine(props: { state: CardState; t: MailNotifyTranslate }): JSX.Element {
  const { state, t } = props
  const status = state.status
  const questionsOn = state.fields.find((entry) => entry.def.field === 'notifyQuestions')?.text === 'true'
  const smtpConfigured = status?.smtpConfigured === true
  return (
    <span style={HINT} data-dsh-mail-notify-summary="">
      <span style={{ color: status?.active === true ? COLORS.good : COLORS.muted }}>
        {status === undefined ? t('value.unknown') : status.active ? t('summary.active') : t('summary.inactive')}
      </span>
      {' · '}
      <span style={{ color: smtpConfigured ? COLORS.good : COLORS.warn }}>
        {smtpConfigured ? t('summary.smtpConfigured') : t('summary.smtpMissing')}
      </span>
      {' · '}
      <span>{questionsOn ? t('summary.questionsOn') : t('summary.questionsOff')}</span>
    </span>
  )
}

/** The disclosure's header: a real button, so pointer, Enter, and Space all work. */
function DisclosureHeader(props: {
  open: boolean
  title: string
  controls: string
  state: CardState
  t: MailNotifyTranslate
  onToggle: () => void
}): JSX.Element {
  const { open, title, controls, state, t, onToggle } = props
  return (
    <button
      type="button"
      className="dsh-mail-notify-disclosure"
      style={HEADER_BUTTON}
      aria-expanded={open}
      aria-controls={controls}
      // The accessible name states the action, not just the subject: a control
      // announced as "Mail notifications, button" leaves the reader to guess
      // what pressing it does.
      aria-label={`${t(open ? 'summary.collapse' : 'summary.expand')}: ${title}`}
      onClick={onToggle}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <strong style={{ fontSize: 15 }}>{title}</strong>
        {open ? null : <SummaryLine state={state} t={t} />}
      </span>
      {state.dirty ? (
        <span style={{ ...HINT, color: COLORS.warn, whiteSpace: 'nowrap' }}>{t('summary.unsaved')}</span>
      ) : null}
      <span aria-hidden="true" style={{ color: COLORS.muted, fontSize: 12 }}>
        {open ? '▾' : '▸'}
      </span>
    </button>
  )
}

/**
 * Render one plugin configuration card.
 *
 * Returns nothing while the host does not serve the namespace: a deployment
 * that does not compose this plugin should show no trace of it, rather than a
 * disabled card the user cannot act on.
 *
 * @param props - the injected controller face plus the framework's `t` seat.
 * @returns the card, or `null` while the namespace is unavailable.
 */
export function MailNotifyCardView(props: MailNotifyCardFace & { t: MailNotifyTranslate }): JSX.Element | null {
  const { card, t } = props
  const state = useCardState(card)
  const [open, setOpen] = useState(false)
  const bodyId = useId()

  // The status strip reads live host facts — whether the runtime is mounted,
  // how deep the queue is, how many messages have gone out — and none of them
  // is pushed to the browser. They are therefore pulled: once when the card
  // appears, and then on a slow poll for as long as it stays mounted. The tab
  // keeps a selected tab mounted, so a one-shot read at mount would leave the
  // strip describing the moment Settings was opened rather than the moment the
  // user is reading it.
  //
  // The poll is deliberately independent of the disclosure: the collapsed
  // summary reports the same live facts, and a collapsed card that stopped
  // reading them would show a summary describing a runtime that has since
  // stopped.
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
  const toggle = (): void => {
    setOpen((current) => !current)
  }
  const title = t('title')

  return (
    <section style={open ? FRAME : FRAME_COLLAPSED} aria-label={title}>
      <FocusRule />
      <DisclosureHeader
        open={open}
        title={title}
        controls={bodyId}
        state={state}
        t={t}
        onToggle={toggle}
      />

      {open ? (
        <div id={bodyId} role="region" aria-label={title} style={{ ...ROW, gap: 12, marginTop: 12 }}>
          <span style={HINT}>{t('subtitle')}</span>
          <span style={HINT}>{t('description')}</span>

          <div style={GROUP}>
            <span style={GROUP_TITLE}>{t('group.status')}</span>
            <StatusStrip state={state} t={t} />
          </div>

          <div style={{ ...GROUP, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '10px 12px' }}>
            <span style={{ ...GROUP_TITLE, color: 'inherit' }}>{t('group.humanAttention')}</span>
            <span style={HINT}>{t('attention.intro')}</span>
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
            title={t('group.general')}
            fields={GENERAL_FIELDS}
            state={state}
            t={t}
            onChange={onChange}
            onReset={onReset}
          />
          <FieldGroup
            title={t('group.notifications')}
            fields={ORDINARY_NOTIFICATION_FIELDS}
            state={state}
            t={t}
            onChange={onChange}
            onReset={onReset}
          />
          <FieldGroup
            title={t('group.smtp')}
            fields={SMTP_FIELDS}
            state={state}
            t={t}
            onChange={onChange}
            onReset={onReset}
          />
          <div style={GROUP}>
            <span style={GROUP_TITLE}>{t('group.credential')}</span>
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
              title=""
              fields={[CREDENTIAL_REF_FIELD]}
              state={state}
              t={t}
              onChange={onChange}
              onReset={onReset}
            />
          </div>
          <FieldGroup
            title={t('group.message')}
            fields={MESSAGE_FIELDS}
            state={state}
            t={t}
            onChange={onChange}
            onReset={onReset}
          />
          <FieldGroup
            title={t('group.delivery')}
            fields={DELIVERY_FIELDS}
            state={state}
            t={t}
            onChange={onChange}
            onReset={onReset}
          />

          {state.testEmail === undefined ? null : (
            <span style={{ ...HINT, color: state.testEmail.delivered ? COLORS.good : COLORS.bad }}>
              {compose(t, state.testEmail.message)}
            </span>
          )}
          {state.notice === undefined ? null : <span style={HINT}>{compose(t, state.notice)}</span>}
          {state.noticeDetail === undefined ? null : (
            <span style={{ ...HINT, color: COLORS.bad }}>{compose(t, state.noticeDetail)}</span>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={disabled || state.testing}
              onClick={() => {
                void card.sendTestEmail()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
            >
              {state.testing ? t('action.sending') : t('action.sendTest')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                card.resetAll()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
              title={t('action.resetTitle')}
            >
              {t('action.reset')}
            </button>
            <button
              type="button"
              disabled={disabled || !state.dirty}
              onClick={() => {
                card.discard()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
            >
              {t('action.discard')}
            </button>
            <button
              type="button"
              disabled={disabled || !state.dirty || state.invalid}
              onClick={() => {
                void card.save()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              {state.saving ? t('action.saving') : t('action.save')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
