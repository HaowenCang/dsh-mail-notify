/**
 * The `dsh-mail-notify` configuration card.
 *
 * Rendered inside Settings → Plugins → Plugin configuration, one card among the
 * deployment's plugin cards. The card owns every part of its own surface —
 * chrome, controls, and copy — because the tab that dispatches it knows only
 * the settings namespace it is keyed by.
 *
 * The whole card is a disclosure, collapsed by default. The header is a
 * semantic `<button>` carrying `aria-expanded` and `aria-controls`; Enter and
 * Space activation therefore come from the platform, not from a key handler,
 * and the body — the entire form — is absent from the layout while collapsed,
 * which is what keeps the card to roughly one settings row so the rest of the
 * Settings page stays reachable. Disclosure state is presentation state: it
 * lives in this component, is never written to any store, and hiding the body
 * does not unmount the controller, so staged drafts and in-flight operations
 * survive a collapse exactly as they survive a tab switch.
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

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
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

/** The two switches the card renders as its own block. */
const PRIVACY_FIELDS = NOTIFICATION_FIELDS.filter((def) => def.privacy === true)

/**
 * How often the card re-reads the host's live facts while it is on screen.
 *
 * Slow on purpose: these are counters and a queue depth, not a live feed, and a
 * faster poll would put a request on the wire every few seconds without telling
 * the user anything sooner. The poll deliberately continues while the card is
 * collapsed, because the collapsed header summarizes those same facts.
 */
const STATUS_POLL_MS = 5000

/** The notification switches rendered under the privacy block. */
const ORDINARY_NOTIFICATION_FIELDS = NOTIFICATION_FIELDS.filter((def) => def.privacy !== true)

/** The card's visible title, as the settings vocabulary names it. */
const TITLE = 'Mail notifications'

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

/** The disclosure header: one full-width semantic button over the summary. */
const HEADER: CSSProperties = {
  appearance: 'none',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '2px 0',
  margin: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 6,
}

const HEAD_TEXT: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
}

const CHEVRON: CSSProperties = {
  flex: 'none',
  fontSize: 13,
  lineHeight: 1,
  color: COLORS.muted,
  transition: 'transform 0.16s',
}

/** The revealed form: a divided region below the header. */
const BODY: CSSProperties = {
  borderTop: `1px solid ${COLORS.border}`,
  paddingTop: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

/** Identity of the one stylesheet this card injects (focus and hover states). */
const STYLE_ID = 'dsh-mail-notify-card-style'

/**
 * Styles that inline style attributes cannot express.
 *
 * The visible focus ring is the accessibility requirement that forced this:
 * `:focus-visible` is a pseudo-class, so it needs a real stylesheet. The tag is
 * injected once per document, guarded by id, following the pattern the shell's
 * own client packages use for their module styles.
 */
const STYLE_CSS = [
  '.dsh-mail-notify__header:focus-visible{',
  'outline:2px solid var(--dsw-alias-brand-primary, var(--dsh-accent, #4c8dff));',
  'outline-offset:-2px;}',
  '.dsh-mail-notify__header:hover{',
  'background:var(--dsw-alias-bg-hover, rgba(127,127,127,0.08));}',
].join('')

/** Inject the card's stylesheet once per document. */
function ensureCardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = STYLE_CSS
  document.head.appendChild(tag)
}

/** Read a boolean field's effective tri-state from the projection. */
function effectiveOf(state: CardState, field: string): 'on' | 'off' | 'inherited' {
  const found = state.fields.find((entry) => entry.def.field === field)
  if (found === undefined) return 'inherited'
  if (found.text === 'true') return 'on'
  if (found.text === 'false') return 'off'
  return 'inherited'
}

/**
 * The collapsed header's one-line operational summary.
 *
 * Deliberately narrow: runtime liveness, SMTP readiness, the effective question
 * switch, and — while one crosses the wire — the busy state. It renders no
 * recipient, no user name, no credential fact beyond readiness, and no queue
 * detail; those stay in the expanded Status block.
 *
 * @param state - the card projection.
 * @returns the summary line.
 */
function summaryText(state: CardState): string {
  const bits: string[] = []
  if (state.status === undefined) {
    bits.push('Status unknown', 'SMTP unknown')
  } else {
    bits.push(state.status.active ? 'Active' : 'Inactive')
    bits.push(state.status.smtpConfigured ? 'SMTP configured' : 'SMTP not configured')
  }
  const questions = effectiveOf(state, 'notifyQuestions')
  bits.push(`Questions ${questions === 'inherited' ? 'inherited' : questions}`)
  if (state.saving) bits.push('Saving…')
  if (state.testing) bits.push('Sending…')
  return bits.join(' · ')
}

/** One field's control, chosen by the field's declared kind. */
function FieldControl(props: { def: FieldDef; state: FieldState; disabled: boolean; onChange: (text: string) => void; onReset: () => void }): JSX.Element {
  const { def, state, disabled, onChange, onReset } = props
  return (
    <div style={ROW}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ minWidth: 220 }}>{def.label}</span>
        {def.kind === 'boolean' ? (
          <select
            style={{ ...INPUT, maxWidth: 140 }}
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
            <option value="">inherit</option>
            <option value="true">on</option>
            <option value="false">off</option>
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
            title="Remove this override so the field re-inherits the composition value"
          >
            reset
          </button>
        ) : (
          <span style={HINT}>inherited</span>
        )}
      </label>
      <span style={HINT}>{def.hint}</span>
      {state.invalid ? <span style={{ ...HINT, color: COLORS.bad }}>This value will block the save.</span> : null}
    </div>
  )
}

/** Render a titled group of fields. */
function FieldGroup(props: {
  title: string
  fields: readonly FieldDef[]
  state: CardState
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
function StatusStrip(props: { state: CardState }): JSX.Element {
  const { state } = props
  const status = state.status
  const bits: JSX.Element[] = []
  bits.push(
    <span key="active" style={{ color: status?.active === true ? COLORS.good : COLORS.muted }}>
      plugin {status === undefined ? 'unknown' : status.active ? 'active' : 'not running'}
    </span>,
  )
  bits.push(
    <span key="cred" style={{ color: state.secret.configured ? COLORS.good : COLORS.warn }}>
      credential {state.secret.known ? (state.secret.configured ? 'configured' : 'missing') : 'unknown'}
    </span>,
  )
  if (status?.queue !== undefined) {
    bits.push(
      <span key="queue">
        queue {status.queue.depth}/{status.queue.size} · {status.queue.delivered} delivered · {status.queue.failed} failed
      </span>,
    )
  }
  return (
    <div style={GROUP}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>{bits}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, fontWeight: 600 }}>
        <span>Effective question notifications: {effectiveOf(state, 'notifyQuestions')}</span>
        <span>Effective approval notifications: {effectiveOf(state, 'notifyApprovals')}</span>
      </div>
      {status?.configError === undefined ? null : (
        <span style={{ ...HINT, color: COLORS.bad }}>
          The saved configuration cannot be applied, so the previous settings are still in effect: {status.configError}
        </span>
      )}
    </div>
  )
}

/** The write-only credential control. */
function SecretControl(props: { state: CardState; onChange: (text: string) => void; onClear: () => void }): JSX.Element {
  const { state, onChange, onClear } = props
  const disabled = state.saving || !state.writable
  return (
    <div style={ROW}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ minWidth: 220 }}>SMTP password</span>
        <input
          style={INPUT}
          type="password"
          autoComplete="new-password"
          placeholder="leave blank to keep the current password"
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
          title="Remove the stored value for this reference"
        >
          clear stored password
        </button>
      </label>
      <span style={HINT}>
        {state.secret.configured
          ? 'A password is stored for this reference. It is never sent to the browser; typing a new one replaces it.'
          : 'No password is stored for this reference yet. Typing one stores it without it ever being read back.'}
      </span>
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
 * @param props - the injected controller face.
 * @returns the card, or `null` while the namespace is unavailable.
 */
export function MailNotifyCardView(props: MailNotifyCardFace): JSX.Element | null {
  const card = props.card
  const state = useCardState(card)

  // Presentation state, component-local: collapsed is the default, nothing
  // persists it, and it never reaches the controller — which is why drafts and
  // in-flight operations outlive a collapse.
  const [open, setOpen] = useState(false)
  const bodyId = useId()

  // The status strip reads live host facts — whether the runtime is mounted,
  // how deep the queue is, how many messages have gone out — and none of them
  // is pushed to the browser. They are therefore pulled: once when the card
  // appears, and then on a slow poll for as long as it stays mounted —
  // collapsed included, since the header summarizes the same facts. The tab
  // keeps a selected tab mounted, so a one-shot read at mount would leave the
  // strip describing the moment Settings was opened rather than the moment the
  // user is reading it.
  useEffect(() => {
    ensureCardStyles()
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
    <section style={FRAME} aria-label="dsh-mail-notify configuration">
      <button
        type="button"
        className="dsh-mail-notify__header"
        style={HEADER}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={`${open ? 'Hide' : 'Show'} ${TITLE} settings`}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span style={HEAD_TEXT}>
          <strong style={{ fontSize: 15, lineHeight: 1.4 }}>{TITLE}</strong>
          <span style={HINT}>{summaryText(state)}</span>
        </span>
        <span style={CHEVRON} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open ? (
        <div id={bodyId} style={BODY}>
          <div style={{ ...GROUP, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '10px 12px' }}>
            <span style={{ ...GROUP_TITLE, color: 'inherit' }}>Human attention</span>
            <span style={HINT}>
              These two are the reason a notification exists: an agent that has stopped and is waiting for you. Both are
              off by default.
            </span>
            {PRIVACY_FIELDS.map((def) => {
              const field = state.fields.find((entry) => entry.def.field === def.field)
              if (field === undefined) return null
              return (
                <FieldControl
                  key={def.field}
                  def={def}
                  state={field}
                  disabled={disabled}
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
            title="General"
            fields={GENERAL_FIELDS}
            state={state}
            onChange={onChange}
            onReset={onReset}
          />
          <FieldGroup
            title="Other notifications"
            fields={ORDINARY_NOTIFICATION_FIELDS}
            state={state}
            onChange={onChange}
            onReset={onReset}
          />
          <FieldGroup title="SMTP" fields={SMTP_FIELDS} state={state} onChange={onChange} onReset={onReset} />
          <SecretControl
            state={state}
            onChange={(text) => {
              card.setSecretDraft(text)
            }}
            onClear={() => {
              void card.clearCredential()
            }}
          />
          <FieldGroup
            title="Credential"
            fields={[CREDENTIAL_REF_FIELD]}
            state={state}
            onChange={onChange}
            onReset={onReset}
          />
          <FieldGroup
            title="Message content"
            fields={MESSAGE_FIELDS}
            state={state}
            onChange={onChange}
            onReset={onReset}
          />
          <FieldGroup title="Delivery" fields={DELIVERY_FIELDS} state={state} onChange={onChange} onReset={onReset} />

          <div style={GROUP}>
            <span style={GROUP_TITLE}>Status</span>
            <StatusStrip state={state} />
          </div>

          {state.testEmail === undefined ? null : (
            <span style={{ ...HINT, color: state.testEmail.delivered ? COLORS.good : COLORS.bad }}>
              {state.testEmail.message}
            </span>
          )}
          {state.notice === undefined ? null : <span style={HINT}>{state.notice}</span>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={disabled || state.testing}
              onClick={() => {
                void card.sendTestEmail()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
            >
              {state.testing ? 'Sending…' : 'Send test email'}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                card.resetAll()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
              title="Remove every override this plugin owns, so the composition values and schema defaults apply again"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={disabled || !state.dirty}
              onClick={() => {
                card.discard()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer' }}
            >
              Discard
            </button>
            <button
              type="button"
              disabled={disabled || !state.dirty || state.invalid}
              onClick={() => {
                void card.save()
              }}
              style={{ ...INPUT, maxWidth: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              {state.saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
