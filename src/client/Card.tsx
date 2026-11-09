/**
 * The `dsh-mail-notify` settings page, plus the two small views that point to
 * it: the navigation icon and the note left on the plugin's detail page.
 *
 * Rendered as its own page of the DSH Settings window (Ctrl+, / ⌘+,), one entry
 * of the `settings.section` list beside General, Models, and Plugins. The page
 * owns every part of its surface — chrome, controls, and copy — because the
 * Settings shell knows only the section's id, order, and nav label.
 *
 * ## Layout, top to bottom
 *
 * 1. **Title and one-paragraph introduction** — what the plugin does, and that
 *    nothing applies until Save.
 * 2. **Status** — one headline (running, off, setup needed, settings rejected),
 *    the numbered setup steps until all four are done, which events currently
 *    send mail, the queue counters, and the test-email action. Every fact here
 *    reads the *saved* configuration, never a draft: an unsaved edit can move a
 *    control without moving a line that claims to describe what is running.
 * 3. **The master switch**, on its own.
 * 4. **Grouped settings** in the order a person sets the plugin up: when to
 *    send, the sending account, the email's content, quiet rules.
 * 5. **Advanced**, collapsed by default — tuning a first-time user never needs.
 * 6. **A sticky save bar** that says when there are unsaved changes.
 *
 * Collapsing Advanced is presentation state only: it lives in this component
 * and is never persisted, and collapsing unmounts nothing the controller owns,
 * so staged drafts, in-flight saves, and operation results all survive it.
 *
 * Every visible string comes from the framework-injected `t` seat over the
 * `dsh-mail-notify` locale namespace (see `locale.ts`), including operation
 * messages and validation refusals, which the controller stores as semantic
 * identities and this component translates at render. Nothing here branches on
 * a language, and a live DSH locale switch re-renders the page — the notice on
 * screen included — in the new language.
 *
 * @module dsh-mail-notify/client/Card
 */

import { Fragment, useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { JSX, ReactNode } from 'react'
import type { CardState, FieldState, MailNotifyCard, MailNotifyCardFace } from './controller.ts'
import {
  ADVANCED_FIELDS,
  ENABLED_FIELD,
  EVENT_FIELDS,
  MESSAGE_FIELDS,
  QUIET_FIELDS,
  SMTP_FIELDS,
  GENERIC_GUIDE,
  SMTP_PRESETS,
  fieldDef,
  type FieldDef,
  type SmtpPreset,
} from './fields.ts'
import type { MailNotifyLocaleKey, MailNotifyTranslate } from './locale.ts'

/**
 * The composed props the slot machinery hands the page: the registrant's own
 * face plus the framework-synthesized locale seat for the declared namespace.
 * `close` is the Settings shell's one affordance for a section; the page has no
 * flow that leaves Settings, so it is accepted and unused.
 */
export type MailNotifyCardProps = MailNotifyCardFace & {
  t: MailNotifyTranslate
  close?: () => void
}

/**
 * How often the page re-reads the host's live facts while it is on screen.
 *
 * Slow on purpose: these are counters and a queue depth, not a live feed, and a
 * faster poll would put a request on the wire every few seconds without telling
 * the user anything sooner.
 */
const STATUS_POLL_MS = 5000

/**
 * The page's stylesheet.
 *
 * Colors, radii, and the focus ring come from the DSH design tokens
 * (`--dsw-*`) the built-in Settings pages use, each with a fallback so the page
 * stays legible in a shell that does not define them. Every class is prefixed
 * `dmn-` so nothing here can restyle the shell or another section.
 */
const PAGE_CSS = `
.dmn-page{--dmn-fg:var(--dsw-alias-label-primary,inherit);--dmn-fg2:var(--dsw-alias-label-secondary,rgba(127,127,127,1));--dmn-border:var(--dsw-alias-border-l2,rgba(127,127,127,.3));--dmn-good:var(--dsw-alias-state-success-primary,#2e7d32);--dmn-bad:var(--dsw-alias-state-error-primary,#c0392b);--dmn-warn:var(--dsw-alias-state-warning-primary,#b26a00);--dmn-brand:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4d6bfe);--dmn-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));--dmn-surface:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.06));--dmn-bg:var(--dsw-alias-bg-layer-2,Canvas);--dmn-sm:var(--dsw-radius-sm,6px);--dmn-md:var(--dsw-radius-md,8px);color:var(--dmn-fg);font-size:14px;line-height:22px;display:flex;flex-direction:column;gap:28px;padding-top:2px}
.dmn-head h2{margin:0;font-size:16px;font-weight:500;line-height:24px}
.dmn-head p{margin:4px 0 0;color:var(--dmn-fg2);font-size:13px;line-height:20px}
.dmn-group{display:flex;flex-direction:column}
.dmn-group-title{margin:0;font-size:14px;font-weight:600;line-height:22px}
.dmn-group-hint{margin:2px 0 0;color:var(--dmn-fg2);font-size:12px;line-height:18px}
.dmn-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:14px 0;border-bottom:.5px solid var(--dmn-border)}
.dmn-row:last-child{border-bottom:none}
.dmn-row--stack{flex-direction:column;align-items:stretch;gap:8px}
.dmn-row--master{border:1px solid var(--dmn-border);border-radius:var(--dmn-md);padding:14px 16px}
.dmn-row--master .dmn-label{font-weight:600}
.dmn-row-text{flex:1;min-width:0}
.dmn-label{font-size:14px;line-height:20px}
.dmn-req{color:var(--dmn-bad);margin-left:3px}
.dmn-desc{margin-top:4px;color:var(--dmn-fg2);font-size:12px;line-height:18px}
.dmn-msg{margin-top:4px;font-size:12px;line-height:18px}
.dmn-msg--bad{color:var(--dmn-bad)}
.dmn-msg--warn{color:var(--dmn-warn)}
.dmn-msg--good{color:var(--dmn-good)}
.dmn-msg--muted{color:var(--dmn-fg2)}
.dmn-control{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dmn-input,.dmn-select,.dmn-textarea{box-sizing:border-box;height:32px;padding:0 10px;border:1px solid var(--dmn-border);border-radius:var(--dmn-sm);background:transparent;color:inherit;font:inherit;font-size:13px}
.dmn-input{width:240px}
.dmn-input--num{width:110px}
.dmn-select{padding-right:6px;min-width:140px}
.dmn-select option{color:initial}
.dmn-textarea{width:100%;height:auto;min-height:64px;padding:6px 10px;resize:vertical;line-height:20px}
.dmn-input[aria-invalid=true],.dmn-textarea[aria-invalid=true]{border-color:var(--dmn-bad)}
.dmn-input:focus-visible,.dmn-select:focus-visible,.dmn-textarea:focus-visible,.dmn-btn:focus-visible,.dmn-link:focus-visible,.dmn-disclosure:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dmn-brand));outline-offset:1px}
.dmn-input:disabled,.dmn-select:disabled,.dmn-textarea:disabled{opacity:.6}
.dmn-unit{color:var(--dmn-fg2);font-size:12px}
.dmn-switch{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:36px;height:20px;margin:0;border-radius:10px;background:var(--dmn-border);cursor:pointer;transition:background-color .15s}
.dmn-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
.dmn-switch:checked{background:var(--dmn-brand)}
.dmn-switch:checked::after{transform:translateX(16px)}
.dmn-switch:disabled{opacity:.5;cursor:default}
.dmn-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dmn-brand));outline-offset:2px}
.dmn-btn{box-sizing:border-box;height:32px;padding:0 14px;border:1px solid var(--dmn-border);border-radius:var(--dmn-sm);background:transparent;color:inherit;font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}
.dmn-btn:hover:not(:disabled){background:var(--dmn-hover)}
.dmn-btn:disabled{opacity:.5;cursor:default}
.dmn-btn--primary{border-color:var(--dmn-brand);background:var(--dmn-brand);color:#fff;font-weight:500}
.dmn-btn--primary:hover:not(:disabled){background:var(--dmn-brand);filter:brightness(1.08)}
.dmn-btn--danger{color:var(--dmn-bad)}
.dmn-guide{margin:2px 0 14px;padding:12px 14px;border-radius:var(--dmn-md);background:var(--dmn-surface);font-size:13px;line-height:20px}
.dmn-guide-title{margin:0 0 6px;font-weight:600}
.dmn-guide ol{margin:0;padding-left:20px}
.dmn-guide li{margin:2px 0}
.dmn-guide-note{margin:6px 0 0;color:var(--dmn-fg2);font-size:12px;line-height:18px}
.dmn-guide-link{display:inline-block;margin-top:8px;color:var(--dmn-brand);font-size:12px;line-height:18px;text-decoration:none}
.dmn-guide-link:hover{text-decoration:underline}
.dmn-guide-fold{margin:2px 0 14px}
.dmn-guide-fold>summary{cursor:pointer;color:var(--dmn-brand);font-size:12px;line-height:18px;width:max-content}
.dmn-guide-fold[open]>summary{margin-bottom:6px}
.dmn-guide-fold .dmn-guide{margin:0}
.dmn-link{padding:0;border:none;background:none;color:var(--dmn-brand);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dmn-link:hover:not(:disabled){text-decoration:underline}
.dmn-link:disabled{opacity:.5;cursor:default}
.dmn-panel{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dmn-border);border-radius:var(--dmn-md);background:var(--dmn-surface)}
.dmn-panel-title{margin:0;color:var(--dmn-fg2);font-size:12px;font-weight:500;line-height:18px}
.dmn-state{display:flex;align-items:center;gap:8px;font-weight:600}
.dmn-dot{flex:none;width:8px;height:8px;border-radius:50%;background:currentColor}
.dmn-tone-good{color:var(--dmn-good)}
.dmn-tone-warn{color:var(--dmn-warn)}
.dmn-tone-bad{color:var(--dmn-bad)}
.dmn-tone-muted{color:var(--dmn-fg2)}
.dmn-steps{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dmn-step{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px}
.dmn-step-mark{flex:none;display:inline-grid;place-items:center;box-sizing:border-box;width:18px;height:18px;border:1px solid var(--dmn-border);border-radius:50%;color:var(--dmn-fg2);font-size:11px;line-height:1}
.dmn-step--done .dmn-step-mark{border-color:var(--dmn-good);background:var(--dmn-good);color:#fff}
.dmn-step--done .dmn-step-text{color:var(--dmn-fg2)}
.dmn-facts{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:20px}
.dmn-muted{color:var(--dmn-fg2)}
.dmn-test{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dmn-test .dmn-desc{margin:0;flex:1;min-width:180px}
.dmn-details summary{cursor:pointer;color:var(--dmn-fg2);font-size:12px}
.dmn-details p{margin:4px 0 0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dmn-note{margin-top:10px;padding:8px 12px;border-radius:var(--dmn-sm);background:color-mix(in srgb,var(--dmn-warn) 10%,transparent);font-size:12px;line-height:18px}
.dmn-banner{margin:0;padding:8px 12px;border-radius:var(--dmn-sm);background:color-mix(in srgb,var(--dmn-warn) 12%,transparent);font-size:13px;line-height:20px}
.dmn-disclosure{display:flex;align-items:center;gap:8px;width:100%;padding:4px 0;border:none;border-radius:var(--dmn-sm);background:none;color:inherit;font:inherit;font-size:14px;font-weight:600;line-height:22px;text-align:left;cursor:pointer}
.dmn-chevron{flex:none;width:12px;color:var(--dmn-fg2);transition:transform .15s}
.dmn-disclosure[aria-expanded=true] .dmn-chevron{transform:rotate(90deg)}
.dmn-savebar{position:sticky;bottom:0;z-index:1;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:12px 0;border-top:.5px solid var(--dmn-border);background:var(--dmn-bg)}
.dmn-savebar-status{margin-right:auto;font-size:12px;line-height:18px;color:var(--dmn-fg2)}
.dmn-savebar-status--dirty{color:var(--dmn-warn);font-weight:500}
.dmn-savebar-status--bad{color:var(--dmn-bad)}
.dmn-savebar-status--good{color:var(--dmn-good)}
.dmn-moved{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-secondary,inherit);font-size:13px;line-height:20px}
@media (width<=767px){.dmn-row--input{flex-direction:column;align-items:stretch;gap:8px}.dmn-row--input .dmn-control{justify-content:flex-start}.dmn-row--input .dmn-input{width:100%}}
@media (prefers-reduced-motion:reduce){.dmn-switch,.dmn-switch::after,.dmn-chevron{transition:none}}
`

/** Notice keys that report a refusal rather than a confirmation. */
const BAD_NOTICES: ReadonlySet<MailNotifyLocaleKey> = new Set([
  'noticeFixInvalid',
  'noticeFillRequired',
  'noticeSaveRefused',
  'noticeSaveRefusedDefault',
  'noticeCredentialRefused',
])

/** Notice keys that confirm an operation landed. */
const GOOD_NOTICES: ReadonlySet<MailNotifyLocaleKey> = new Set(['noticeSaved', 'noticeCredentialRemoved'])

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

/**
 * The text a control shows: the staged or saved draft, or — for a staged
 * removal or a section that omits the field — the default it resolves to.
 *
 * @param field - the field state.
 * @returns the draft text to render.
 */
function shownText(field: FieldState): string {
  return field.pendingReset || field.text === '' ? field.defaultText : field.text
}

/**
 * Render a draft-text value for a sentence ("Default: …").
 *
 * @param def - the field.
 * @param text - the draft text.
 * @param t - the locale seat.
 * @returns readable text.
 */
function readableValue(def: FieldDef, text: string, t: MailNotifyTranslate): string {
  if (text === '' || text === '[]') return t('emptyValue')
  if (def.kind === 'boolean') {
    const choice = def.choices?.find((entry) => entry.value === text)
    if (choice !== undefined) return t(choice.labelKey)
    return text === 'true' ? t('factOn') : t('factOff')
  }
  if (def.kind === 'lines') return text.split('\n').join(', ')
  if (def.unitKey !== undefined) return `${text} ${t(def.unitKey)}`
  return text
}

/** Look one field's state up, by name. */
function fieldOf(state: CardState, name: string): FieldState | undefined {
  return state.fields.find((entry) => entry.def.field === name)
}

/** The props every field row shares. */
interface RowProps {
  field: FieldState
  disabled: boolean
  t: MailNotifyTranslate
  onChange: (text: string) => void
  onReset: () => void
  /** Extra content under the hint (a warning, a helper action). */
  extra?: ReactNode
  className?: string
}

/** One setting: label and guidance on the left, its control on the right. */
function FieldRow(props: RowProps): JSX.Element {
  const { field, disabled, t, onChange, onReset, extra } = props
  const { def } = field
  const id = useId()
  const hintId = `${id}-hint`
  const shown = shownText(field)
  const stacked = def.kind === 'addresses' || def.kind === 'lines'
  const isSwitch = def.kind === 'boolean' && def.choices === undefined
  const placeholder =
    def.placeholderKey !== undefined
      ? t(def.placeholderKey)
      : field.defaultText !== ''
        ? t('defaultValue', { value: readableValue(def, field.defaultText, t) })
        : undefined
  const defaultReadable = readableValue(def, field.defaultText, t)
  const showListClearHint = def.kind === 'lines' && field.defaultText !== '' && field.defaultText !== '[]'

  let control: JSX.Element
  if (isSwitch) {
    control = (
      <input
        id={id}
        className="dmn-switch"
        type="checkbox"
        role="switch"
        name={def.field}
        checked={shown === 'true'}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(event.target.checked ? 'true' : 'false')
        }}
      />
    )
  } else if (def.kind === 'boolean') {
    control = (
      <select
        id={id}
        className="dmn-select"
        name={def.field}
        value={shown}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      >
        {(def.choices ?? []).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {t(choice.labelKey)}
          </option>
        ))}
      </select>
    )
  } else if (stacked) {
    control = (
      <textarea
        id={id}
        className="dmn-textarea"
        name={def.field}
        rows={def.kind === 'addresses' ? 2 : 3}
        value={field.text}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        aria-describedby={hintId}
        aria-invalid={field.invalid || field.missing}
        aria-required={field.required}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    )
  } else {
    control = (
      <>
        <input
          id={id}
          className={def.kind === 'natural' ? 'dmn-input dmn-input--num' : 'dmn-input'}
          type="text"
          name={def.field}
          inputMode={def.kind === 'natural' ? 'numeric' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={field.text}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={hintId}
          aria-invalid={field.invalid || field.missing}
          aria-required={field.required}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
        {def.unitKey === undefined ? null : <span className="dmn-unit">{t(def.unitKey)}</span>}
      </>
    )
  }

  const rowClass = [
    'dmn-row',
    stacked ? 'dmn-row--stack' : '',
    !isSwitch && !stacked ? 'dmn-row--input' : '',
    props.className ?? '',
  ]
    .filter((entry) => entry !== '')
    .join(' ')

  return (
    <div className={rowClass} data-row={def.field}>
      <div className="dmn-row-text">
        <label className="dmn-label" htmlFor={id}>
          {t(def.labelKey)}
          {def.required === true ? (
            <span className="dmn-req" title={t('requiredMark')} aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        <div className="dmn-desc" id={hintId}>
          {t(def.hintKey)}
          {showListClearHint ? ` ${t('hintListClearDefault')}` : ''}
        </div>
        {field.invalid ? (
          <div className="dmn-msg dmn-msg--bad" data-field-invalid={def.field}>
            {field.issue === undefined
              ? t('invalidBlocksSave')
              : `${t(field.issue.key, { field: t(def.labelKey), ...field.issue.params })} ${t('invalidBlocksSave')}`}
          </div>
        ) : field.missing ? (
          <div className="dmn-msg dmn-msg--bad" data-field-missing={def.field}>
            {t('requiredMissing')}
          </div>
        ) : null}
        {field.pendingReset ? (
          <div className="dmn-msg dmn-msg--muted" data-pending-reset={def.field}>
            {t('pendingReset', { value: defaultReadable })}
          </div>
        ) : null}
        {extra}
        {field.overridden && !field.pendingReset ? (
          <div className="dmn-msg">
            <button
              type="button"
              className="dmn-link"
              disabled={disabled}
              onClick={onReset}
              title={t('resetFieldTitle', { value: defaultReadable })}
              data-action="reset-field"
              data-field={def.field}
            >
              {t('actionResetField')}
            </button>
          </div>
        ) : null}
      </div>
      <div className="dmn-control">{control}</div>
    </div>
  )
}

/** Shared wiring for a list of rows. */
interface RowsProps {
  state: CardState
  fields: readonly FieldDef[]
  t: MailNotifyTranslate
  card: MailNotifyCard
  /** Extra content for one row, by field name. */
  extras?: Readonly<Record<string, ReactNode>>
  /** Content rendered right after one row, by field name. */
  after?: Readonly<Record<string, ReactNode>>
}

/** Render rows for a list of fields, in table order. */
function Rows(props: RowsProps): JSX.Element {
  const { state, t, card } = props
  const disabled = state.saving || !state.writable
  return (
    <>
      {props.fields.map((def) => {
        const field = fieldOf(state, def.field)
        if (field === undefined) return null
        return (
          <Fragment key={def.field}>
            <FieldRow
              field={field}
              disabled={disabled}
              t={t}
              extra={props.extras?.[def.field]}
              onChange={(text) => {
                card.edit(def.field, text)
              }}
              onReset={() => {
                card.resetField(def.field)
              }}
            />
            {props.after?.[def.field]}
          </Fragment>
        )
      })}
    </>
  )
}

/** A titled group of settings. */
function Group(props: { title: string; hint?: string; children: ReactNode; testId: string }): JSX.Element {
  const headingId = useId()
  return (
    <section className="dmn-group" aria-labelledby={headingId} data-group={props.testId}>
      <h3 className="dmn-group-title" id={headingId}>
        {props.title}
      </h3>
      {props.hint === undefined ? null : <p className="dmn-group-hint">{props.hint}</p>}
      {props.children}
    </section>
  )
}

/** The headline the status panel leads with: which copy, and its tone. */
interface Headline {
  key: MailNotifyLocaleKey
  tone: 'good' | 'warn' | 'bad' | 'muted'
}

/**
 * Decide the status headline from saved facts.
 *
 * Setup comes before the host's configuration error on purpose: a fresh install
 * is "enabled with nothing filled in", which the host reports as a list of
 * missing fields. That is not a fault to alarm anyone with; it is the setup the
 * steps below walk through.
 *
 * @param state - the projection.
 * @returns the headline.
 */
function headlineOf(state: CardState): Headline {
  const status = state.status
  if (state.loading || status === undefined) return { key: 'stateLoading', tone: 'muted' }
  if (!state.enabled) return { key: 'stateDisabled', tone: 'muted' }
  if (!state.setup.server || !state.setup.account || !state.setup.addresses) return { key: 'stateSetupNeeded', tone: 'warn' }
  if (status.configError !== undefined) return { key: 'stateConfigError', tone: 'bad' }
  if (status.active) return { key: 'stateActive', tone: 'good' }
  return { key: 'stateInactive', tone: 'muted' }
}

/** One numbered setup step. */
function Step(props: { index: number; done: boolean; label: string; t: MailNotifyTranslate; id: string }): JSX.Element {
  return (
    <li className={props.done ? 'dmn-step dmn-step--done' : 'dmn-step'} data-step={props.id} data-done={props.done}>
      <span className="dmn-step-mark" aria-hidden="true">
        {props.done ? '✓' : String(props.index)}
      </span>
      <span className="dmn-step-text">{props.label}</span>
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
        }}
      >
        {props.done ? props.t('stepDone') : props.t('stepTodo')}
      </span>
    </li>
  )
}

/** The status panel: headline, setup steps, live facts, and the test email. */
function StatusPanel(props: { state: CardState; card: MailNotifyCard; t: MailNotifyTranslate }): JSX.Element {
  const { state, card, t } = props
  const status = state.status
  const headline = headlineOf(state)
  const headingId = useId()
  const steps = [
    { id: 'server', done: state.setup.server, label: t('stepServer') },
    { id: 'account', done: state.setup.account, label: t('stepAccount') },
    { id: 'addresses', done: state.setup.addresses, label: t('stepAddresses') },
    { id: 'test', done: state.setup.tested, label: t('stepTest') },
  ]
  const showSteps = state.enabled && !state.loading && steps.some((step) => !step.done)
  const events = state.activeEvents
    .map((name) => {
      const def = fieldDef(name)
      return def === undefined ? name : t(def.labelKey)
    })
    .join(t('listSeparator'))
  const needsSetup = status !== undefined && !status.smtpConfigured
  const testHint = needsSetup ? 'hintTestEmailNeedsSetup' : state.dirty ? 'hintTestEmailDirty' : 'hintTestEmail'

  return (
    <section className="dmn-panel" aria-labelledby={headingId} data-group="status">
      <h3 className="dmn-panel-title" id={headingId}>
        {t('statusHeading')}
      </h3>
      <div className={`dmn-state dmn-tone-${headline.tone}`} data-summary role="status">
        <span className="dmn-dot" aria-hidden="true" />
        <span>{t(headline.key)}</span>
      </div>

      {state.enabled || state.loading || status === undefined ? null : (
        <p className="dmn-group-hint" style={{ margin: 0 }} data-disabled-hint>
          {t(state.setup.server && state.setup.account && state.setup.addresses ? 'disabledHintReady' : 'disabledHintSetup')}
        </p>
      )}

      {status?.configError === undefined || !state.enabled ? null : (
        <details className="dmn-details">
          <summary>{t('configErrorDetails')}</summary>
          <p>{t('configErrorBody', { message: status.configError })}</p>
        </details>
      )}

      {showSteps ? (
        <div>
          <div className="dmn-panel-title" style={{ marginBottom: 6 }}>
            {t('setupHeading')}
          </div>
          <ol className="dmn-steps">
            {steps.map((step, index) => (
              <Step key={step.id} index={index + 1} done={step.done} label={step.label} t={t} id={step.id} />
            ))}
          </ol>
        </div>
      ) : null}

      {state.enabled && !state.loading ? (
        <div className="dmn-facts">
          <span data-effective>
            {t('activeEvents', {
              value: events === '' ? t('activeEventsNone') : events,
            })}
          </span>
          {status?.queue === undefined ? null : (
            <span className="dmn-muted" data-stats>
              {t('statsLine', {
                delivered: status.queue.delivered,
                failed: status.queue.failed,
                depth: status.queue.depth,
                size: status.queue.size,
              })}
            </span>
          )}
        </div>
      ) : null}

      <div className="dmn-test">
        <button
          type="button"
          className="dmn-btn"
          disabled={state.testing || needsSetup}
          onClick={() => {
            void card.sendTestEmail()
          }}
          data-action="send-test"
        >
          {state.testing ? t('actionSending') : t('actionSendTest')}
        </button>
        <p className="dmn-desc">{t(testHint)}</p>
      </div>
      {state.testEmail === undefined ? null : (
        <div
          className={`dmn-msg ${state.testEmail.delivered ? 'dmn-msg--good' : 'dmn-msg--bad'}`}
          style={{ marginTop: 0 }}
          data-notice="test-email"
          role="status"
        >
          {t(state.testEmail.message.key, state.testEmail.message.params)}
        </div>
      )}
    </section>
  )
}

/** The write-only password control, rendered as one row of the account group. */
function SecretRow(props: { state: CardState; card: MailNotifyCard; t: MailNotifyTranslate }): JSX.Element {
  const { state, card, t } = props
  const id = useId()
  const hintId = `${id}-hint`
  const disabled = state.saving || !state.writable || (state.secret.known && !state.secret.writable)
  const hint =
    state.secret.known && !state.secret.writable
      ? 'hintSecretReadOnly'
      : state.secret.configured
        ? 'hintSecretStored'
        : 'hintSecretMissing'
  return (
    <>
      <div className="dmn-row dmn-row--input" data-row="smtpPasswordSecret">
        <div className="dmn-row-text">
          <label className="dmn-label" htmlFor={id}>
            {t('labelSecret')}
          </label>
          <div className="dmn-desc" id={hintId}>
            {t(hint)}
          </div>
          {state.secret.configured ? (
            <div className="dmn-msg">
              <button
                type="button"
                className="dmn-link"
                disabled={disabled}
                onClick={() => {
                  void card.clearCredential()
                }}
                title={t('passwordClearTitle')}
                data-action="clear-credential"
              >
                {t('passwordClear')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="dmn-control">
          <input
            id={id}
            className="dmn-input"
            type="password"
            name="smtpPasswordSecret"
            autoComplete="new-password"
            aria-describedby={hintId}
            placeholder={t(state.secret.configured ? 'passwordPlaceholderKeep' : 'passwordPlaceholderNew')}
            value={state.secret.draft}
            disabled={disabled}
            onChange={(event) => {
              card.setSecretDraft(event.target.value)
            }}
          />
        </div>
      </div>
      {state.secret.known && !state.secret.writable ? null : state.secret.configured ? (
        <details className="dmn-guide-fold" data-secret-guide-fold>
          <summary>{t('guideShowAgain')}</summary>
          <SecretGuide provider={state.provider} t={t} />
        </details>
      ) : (
        <SecretGuide provider={state.provider} t={t} />
      )}
    </>
  )
}

/** The preset with this id, if any. */
function presetById(id: string | undefined): SmtpPreset | undefined {
  return id === undefined ? undefined : SMTP_PRESETS.find((preset) => preset.id === id)
}

/**
 * Step-by-step instructions for obtaining the SMTP password: the provider's own
 * steps when the server is a known provider's, the steps every provider shares
 * otherwise.
 */
function SecretGuide(props: { provider: string | undefined; t: MailNotifyTranslate }): JSX.Element {
  const { t } = props
  const preset = presetById(props.provider)
  const titleId = useId()
  const params = { name: preset === undefined ? '' : t(preset.labelKey) }
  const guide = preset?.guide ?? GENERIC_GUIDE
  return (
    <div className="dmn-guide" role="group" aria-labelledby={titleId} data-secret-guide={preset?.id ?? 'generic'}>
      <p className="dmn-guide-title" id={titleId}>
        {t(guide.titleKey, params)}
      </p>
      <ol>
        {guide.stepKeys.map((key) => (
          <li key={key}>{t(key, params)}</li>
        ))}
      </ol>
      {guide.noteKey === undefined ? null : <p className="dmn-guide-note">{t(guide.noteKey, params)}</p>}
      {preset === undefined ? null : (
        <a className="dmn-guide-link" href={preset.guide.url} target="_blank" rel="noopener noreferrer" data-guide-link>
          {t(preset.guide.linkKey, params)} ↗
        </a>
      )}
    </div>
  )
}

/** The quick-fill row for common providers. */
function PresetRow(props: { state: CardState; card: MailNotifyCard; t: MailNotifyTranslate }): JSX.Element {
  const { state, card, t } = props
  const id = useId()
  // The control shows what the server already is, so choosing is never needed
  // just to learn which provider is configured.
  const host = state.fields.find((field) => field.def.field === 'smtpHost')
  const hostText = host === undefined ? '' : host.pendingReset ? host.defaultText : host.text
  const presetValue = state.provider ?? (hostText.trim() === '' ? '' : 'custom')
  return (
    <div className="dmn-row dmn-row--input" data-row="smtpPreset">
      <div className="dmn-row-text">
        <label className="dmn-label" htmlFor={id}>
          {t('labelPreset')}
        </label>
        <div className="dmn-desc">{t('hintPreset')}</div>
      </div>
      <div className="dmn-control">
        <select
          id={id}
          className="dmn-select"
          name="smtpPreset"
          value={presetValue}
          disabled={state.saving || !state.writable}
          onChange={(event) => {
            card.applyPreset(event.target.value)
          }}
        >
          {presetValue === '' ? <option value="">{t('presetPlaceholder')}</option> : null}
          {SMTP_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(preset.labelKey)}
            </option>
          ))}
          {presetValue === 'custom' ? <option value="custom">{t('presetCustom')}</option> : null}
        </select>
      </div>
    </div>
  )
}

/** The sticky save bar: unsaved-change status, the operation notice, and the actions. */
function SaveBar(props: { state: CardState; t: MailNotifyTranslate; onSave: () => void; onDiscard: () => void }): JSX.Element {
  const { state, t } = props
  const disabled = state.saving || !state.writable
  const notice = state.notice
  const tone =
    notice === undefined
      ? ''
      : BAD_NOTICES.has(notice.key)
        ? ' dmn-savebar-status--bad'
        : GOOD_NOTICES.has(notice.key)
          ? ' dmn-savebar-status--good'
          : ''
  return (
    <div className="dmn-savebar" data-savebar>
      {notice !== undefined ? (
        <span className={`dmn-savebar-status${tone}`} data-notice="operation" role="status">
          {t(notice.key, notice.params)}
        </span>
      ) : state.dirty ? (
        <span className="dmn-savebar-status dmn-savebar-status--dirty" data-unsaved>
          {t('unsavedChanges')}
        </span>
      ) : (
        <span className="dmn-savebar-status" />
      )}
      <button
        type="button"
        className="dmn-btn"
        disabled={disabled || !state.dirty}
        onClick={props.onDiscard}
        data-action="discard"
      >
        {t('actionDiscard')}
      </button>
      <button
        type="button"
        className="dmn-btn dmn-btn--primary"
        // Not disabled by a refused draft: pressing Save then says what is wrong
        // (and opens Advanced when that is where the refusal is), which a grey
        // button never could.
        disabled={disabled || !state.dirty}
        onClick={props.onSave}
        data-action="save"
      >
        {state.saving ? t('actionSaving') : t('actionSave')}
      </button>
    </div>
  )
}

/**
 * Render the settings page.
 *
 * Returns nothing while the host does not serve the namespace: a deployment
 * that does not compose this plugin should show no trace of it, rather than a
 * disabled page the user cannot act on.
 *
 * @param props - the injected controller face and the locale seat.
 * @returns the page, or `null` while the namespace is unavailable.
 */
export function MailNotifyCardView(props: MailNotifyCardProps): JSX.Element | null {
  const { card, t } = props
  const state = useCardState(card)
  // Presentation state only: nothing persists the expansion, and collapsing
  // changes what the view renders — never what the controller holds.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // The Advanced region's element id, referenced by its header's
  // `aria-controls`. Per-instance via `useId()`: two pages mounted in one
  // document must never claim each other's region.
  const advancedId = useId()

  // The status panel reads live host facts — whether the runtime is mounted,
  // how deep the queue is, how many messages have gone out — and none of them
  // is pushed to the browser. They are therefore pulled: once when the page
  // appears, and then on a slow poll for as long as it stays mounted.
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
  const portWarning =
    state.portMismatch === undefined ? null : (
      <div className="dmn-msg dmn-msg--warn" data-port-warning>
        {t(state.portMismatch === 'port465StartTls' ? 'warnPort465StartTls' : 'warnPort587Tls')}
      </div>
    )
  const user = fieldOf(state, 'smtpUser')
  const from = fieldOf(state, 'from')
  const userText = user === undefined ? '' : shownText(user).trim()
  const canCopyUser = userText !== '' && from !== undefined && shownText(from).trim() !== userText
  const autoFilled = presetById(state.autoFilledProvider)
  const suggested = presetById(state.suggestedProvider)
  const hostNote =
    autoFilled !== undefined ? (
      <div className="dmn-msg dmn-msg--good" data-autofilled={autoFilled.id} role="status">
        {t('autoFilledFromUser', { name: t(autoFilled.labelKey) })}
      </div>
    ) : suggested !== undefined ? (
      <div className="dmn-msg dmn-msg--warn" data-suggest-preset={suggested.id}>
        {t('suggestPreset', {
          name: t(suggested.labelKey),
          host: suggested.host,
        })}{' '}
        <button
          type="button"
          className="dmn-link"
          disabled={disabled}
          onClick={() => {
            card.applyPreset(suggested.id)
          }}
          data-action="use-preset"
        >
          {t('actionUsePreset', { name: t(suggested.labelKey) })}
        </button>
      </div>
    ) : null
  const useUsername = canCopyUser ? (
    <div className="dmn-msg">
      <button
        type="button"
        className="dmn-link"
        disabled={disabled}
        onClick={() => {
          card.useUsernameAsSender()
        }}
        data-action="use-username"
      >
        {t('actionUseUsername')}
      </button>
    </div>
  ) : null
  const advancedInvalid = state.fields.some((entry) => entry.invalid && ADVANCED_FIELDS.includes(entry.def))

  const enabledField = fieldOf(state, ENABLED_FIELD.field)

  return (
    <section className="dmn-page" aria-label={t('pageTitle')} data-mail-notify-page>
      <style>{PAGE_CSS}</style>
      <header className="dmn-head">
        <h2>{t('pageTitle')}</h2>
        <p>{t('pageIntro')}</p>
      </header>

      {state.loading ? <p className="dmn-banner">{t('loading')}</p> : null}
      {!state.loading && !state.writable ? <p className="dmn-banner">{t('readOnly')}</p> : null}

      <StatusPanel state={state} card={card} t={t} />

      {enabledField === undefined ? null : (
        <FieldRow
          field={enabledField}
          disabled={disabled}
          t={t}
          className="dmn-row--master"
          onChange={(text) => {
            card.edit(ENABLED_FIELD.field, text)
          }}
          onReset={() => {
            card.resetField(ENABLED_FIELD.field)
          }}
        />
      )}

      <Group title={t('groupEvents')} hint={t('hintEvents')} testId="events">
        <Rows
          state={state}
          fields={EVENT_FIELDS}
          t={t}
          card={card}
          after={{
            notifyApprovals: (
              <p className="dmn-note" data-privacy-note>
                {t('privacyNote')}
              </p>
            ),
          }}
        />
      </Group>

      <Group title={t('groupSmtp')} hint={t('hintSmtp')} testId="smtp">
        <p className="dmn-group-hint" style={{ marginTop: 6 }}>
          <span className="dmn-req" aria-hidden="true" style={{ marginLeft: 0, marginRight: 3 }}>
            *
          </span>
          {t('requiredNote')}
        </p>
        <PresetRow state={state} card={card} t={t} />
        <Rows
          state={state}
          fields={SMTP_FIELDS}
          t={t}
          card={card}
          extras={{
            smtpHost: hostNote,
            smtpSecure: portWarning,
            from: useUsername,
          }}
          after={{ smtpUser: <SecretRow state={state} card={card} t={t} /> }}
        />
      </Group>

      <Group title={t('groupMessage')} testId="message">
        <Rows state={state} fields={MESSAGE_FIELDS} t={t} card={card} />
      </Group>

      <Group title={t('groupQuiet')} testId="quiet">
        <Rows state={state} fields={QUIET_FIELDS} t={t} card={card} />
      </Group>

      <section className="dmn-group" data-group="advanced">
        <button
          type="button"
          className="dmn-disclosure"
          aria-expanded={advancedOpen}
          aria-controls={advancedId}
          onClick={() => {
            setAdvancedOpen((open) => !open)
          }}
        >
          <span className="dmn-chevron" aria-hidden="true">
            ▸
          </span>
          <span>{t('groupAdvanced')}</span>
          <span className="dmn-muted" style={{ fontWeight: 400, fontSize: 12 }}>
            {t('hintAdvanced')}
          </span>
        </button>
        <div id={advancedId} hidden={!advancedOpen}>
          {advancedOpen ? (
            <>
              <Rows state={state} fields={ADVANCED_FIELDS} t={t} card={card} />
              <div className="dmn-row" data-row="resetAll">
                <div className="dmn-row-text">
                  <div className="dmn-label">{t('labelResetAll')}</div>
                  <div className="dmn-desc">{t('hintResetAll')}</div>
                </div>
                <div className="dmn-control">
                  <button
                    type="button"
                    className="dmn-btn dmn-btn--danger"
                    disabled={disabled}
                    onClick={() => {
                      card.resetAll()
                    }}
                    data-action="reset-all"
                  >
                    {t('actionResetAll')}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <SaveBar
        state={state}
        t={t}
        onSave={() => {
          // A refused draft hidden under a collapsed Advanced section would
          // block the save with nothing on screen to fix; open it first.
          if (advancedInvalid) setAdvancedOpen(true)
          void card.save()
        }}
        onDiscard={() => {
          card.discard()
        }}
      />
    </section>
  )
}

/**
 * The note the plugin leaves on its own Plugins → Installed detail page.
 *
 * That page used to host the whole form. A person who still looks for the
 * settings there is told where they went instead of finding an empty section.
 *
 * @param props - the slot's view and the locale seat.
 * @returns the note on the full page view; nothing on the one-line summary.
 */
export function MailNotifyMovedNotice(props: { view: 'summary' | 'page'; t: MailNotifyTranslate }): JSX.Element | null {
  if (props.view !== 'page') return null
  return (
    <>
      <style>{PAGE_CSS}</style>
      <p className="dmn-moved" data-moved-notice>
        {props.t('movedNotice')}
      </p>
    </>
  )
}

/**
 * The Settings navigation icon: an envelope, drawn in `currentColor` so it
 * follows the shell's active and hover colors.
 *
 * @param props - the requested square size.
 * @returns the icon.
 */
export function MailNotifyNavIcon(props: { size: number; active?: boolean }): JSX.Element {
  const size = props.size
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 6l6.5 4.75L16.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
