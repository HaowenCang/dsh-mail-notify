/**
 * The `dsh-mail-notify` configuration card.
 *
 * Rendered inside Settings → Plugins → Plugin configuration, one card among the
 * deployment's plugin cards. The card owns every part of its own surface —
 * chrome, controls, and copy — because the tab that dispatches it knows only
 * the settings namespace it is keyed by.
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

import { useCallback, useEffect, useSyncExternalStore } from 'react'
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
  const effective = (field: string): string => {
    const found = state.fields.find((entry) => entry.def.field === field)
    if (found === undefined) return 'unknown'
    if (found.text === 'true') return 'on'
    if (found.text === 'false') return 'off'
    return 'inherit'
  }
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
        <span>Effective question notifications: {effective('notifyQuestions')}</span>
        <span>Effective approval notifications: {effective('notifyApprovals')}</span>
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
    <section style={FRAME} aria-label="dsh-mail-notify configuration">
      <header style={ROW}>
        <strong style={{ fontSize: 15 }}>dsh-mail-notify</strong>
        <span style={HINT}>
          Emails a top-level turn’s final output, its terminal failures, and its mid-turn requests for a person over
          SMTP.
        </span>
      </header>

      <StatusStrip state={state} />

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
    </section>
  )
}
