/**
 * The settings page's controller: staged drafts over one Host configuration entry, plus
 * the actions that write them.
 *
 * Two stores sit underneath and they must not be conflated. The configuration
 * form is the *host's* state — a revision-fenced document this card only reads —
 * and the staged map is the *user's* pending intent. The rendered snapshot is a
 * projection of both, rebuilt whenever either moves, and it is published
 * through one `getSnapshot`/`subscribe` pair so the card can read it with
 * `useSyncExternalStore`.
 *
 * A field shows its effective value and separately whether the user layer
 * carries it. Presence, not a value comparison, is what marks a field
 * overridden: an override equal to the composition default is still an
 * override, and comparing values could not see it. The Host contract says the
 * same thing in its own words — `ConfigFormSnapshot.user` is the raw user layer,
 * and a field's presence there is what marks it overridden. That is also what
 * makes Reset meaningful: a reset is the *removal* of a user-layer entry, so the
 * field re-inherits the composition layer rather than being written to a copy of
 * it.
 *
 * @module dsh-mail-notify/client/card
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { SETTINGS_NAMESPACE, type QueueStatusValue, type StatusValue } from '../protocol.ts'
import type { ClientContext, ConfigForm, ConfigFormSnapshot } from './contracts.ts'
import {
  ALL_FIELDS,
  CREDENTIAL_REF_FIELD,
  ENABLED_FIELD,
  EVENT_SWITCHES,
  SMTP_PRESETS,
  presetForAddress,
  presetForHost,
  credentialRefFrom,
  fieldDef,
  formatField,
  isFilled,
  parseField,
  type FieldDef,
  type FieldIssue,
} from './fields.ts'
import type { LocalizedMessage } from './locale.ts'
import {
  describeCredential,
  onCredentialUpdated,
  readRuntimeStatus,
  requestTestEmail,
  setCredential,
  unsetCredential,
  type CredentialFacts,
} from './wire.ts'

/** The section shape this card edits: namespace-owned keys, schema-resolved. */
type Section = Record<string, unknown>

/** One control's rendered state. */
export interface FieldState {
  readonly def: FieldDef
  /** Draft text the control renders. */
  readonly text: string
  /** Whether saving would leave a user-layer entry for this field. */
  readonly overridden: boolean
  /** Whether the draft is not a value this field accepts. */
  readonly invalid: boolean
  /** The refusal's semantic identity while `invalid`, translated at render. */
  readonly issue: FieldIssue | undefined
  /**
   * The draft text the field goes back to when its override is removed: the
   * composition layer's value when the deployment sets one, otherwise the
   * schema default. What "Restore default" restores, shown before it happens.
   */
  readonly defaultText: string
  /** Whether a removal of the override is staged (saving restores the default). */
  readonly pendingReset: boolean
  /** Whether the field must be filled in for the save to be accepted. */
  readonly required: boolean
  /** Whether a required field would be empty after a save. */
  readonly missing: boolean
}

/** The write-only credential control's state. */
export interface SecretState {
  /** The draft. Always empty until typed, and cleared once a save lands. */
  readonly draft: string
  /** Whether the reference currently holds a value. */
  readonly configured: boolean
  /** Whether this deployment may write the reference. */
  readonly writable: boolean
  /** Whether `describe` has answered at least once. */
  readonly known: boolean
}

/** The outcome of the last delivery test. */
export interface TestEmailState {
  readonly delivered: boolean
  readonly recipientCount: number
  /** Semantic identity of the rendered outcome; translated at render time. */
  readonly message: LocalizedMessage
}

/**
 * The setup facts the page's progress list reports, read from the *saved*
 * configuration — what a notification would actually use — never from drafts.
 */
export interface SetupState {
  /** The SMTP server is filled in. */
  readonly server: boolean
  /** The user name is filled in and a password is stored for the reference. */
  readonly account: boolean
  /** The sender and at least one recipient are filled in. */
  readonly addresses: boolean
  /** A test email was accepted by the SMTP server during this page's lifetime. */
  readonly tested: boolean
}

/** Port/encryption combinations that almost never connect, for an inline warning. */
export type PortSecurityMismatch = 'port465StartTls' | 'port587Tls'

/** Everything the card renders, as one immutable projection. */
export interface CardState {
  /** False while the host does not serve this namespace; the card renders nothing. */
  readonly available: boolean
  /** True until the host has answered with the namespace's first section. */
  readonly loading: boolean
  /** Whether the host document accepts writes. */
  readonly writable: boolean
  /** Whether the form holds edits a save would write. */
  readonly dirty: boolean
  /** Whether any staged draft is refused, which blocks the save. */
  readonly invalid: boolean
  /** Whether a save is crossing the wire. */
  readonly saving: boolean
  /** Whether the last save did not land as staged. */
  readonly failed: boolean
  /** The staged, effective, or composed value of every field, in render order. */
  readonly fields: readonly FieldState[]
  /**
   * The effective question-notification switch, as the running configuration
   * reads it: the composed section, never a staged draft. Staged edits move it
   * only when a save lands — the collapsed summary and the expanded status
   * strip both report this fact, so an unsaved Reset/Clear can never claim
   * questions are off while they run.
   */
  readonly questionsOn: boolean
  /**
   * The effective approval-notification switch, under the same contract as
   * {@link CardState.questionsOn}: the composed section, never a staged draft,
   * so the expanded status strip's "Effective approval notifications" line
   * obeys the save boundary too.
   */
  readonly approvalsOn: boolean
  /** Whether the *saved* configuration has the plugin switched on. */
  readonly enabled: boolean
  /**
   * The event switches the *saved* configuration has on, in table order. Like
   * {@link CardState.questionsOn}, only a landed save moves it.
   */
  readonly activeEvents: readonly string[]
  /** Saved-configuration setup progress. */
  readonly setup: SetupState
  /**
   * Required fields that would be empty after a save while the plugin would be
   * on, in table order. Non-empty means Save is refused locally.
   */
  readonly missingRequired: readonly string[]
  /** A port/encryption pairing the draft would save that normally fails to connect. */
  readonly portMismatch: PortSecurityMismatch | undefined
  /**
   * The provider preset the server will be once saved — the staged server if
   * there is one, else the saved one. Drives the quick-fill control's shown
   * value and which authorization-code guide the page offers.
   */
  readonly provider: string | undefined
  /**
   * The provider the username's address belongs to, when it differs from the
   * server's and a server is filled in: worth a one-click correction, never an
   * automatic overwrite of something the person typed.
   */
  readonly suggestedProvider: string | undefined
  /** The provider whose endpoint was filled in from the username, until the person edits it. */
  readonly autoFilledProvider: string | undefined
  /** The credential reference in effect. A name, never a value. */
  readonly credentialRef: string
  readonly secret: SecretState
  /** Live host facts, once the first read has answered. */
  readonly status: StatusValue | undefined
  /**
   * A refusal or confirmation from the last action, as semantic identity —
   * stored untranslated so a notice already on screen follows a live locale
   * switch.
   */
  readonly notice: LocalizedMessage | undefined
  /** Whether a delivery test is in flight. */
  readonly testing: boolean
  /** The last delivery test's outcome. */
  readonly testEmail: TestEmailState | undefined
}

/** The face a slot registration injects, so the card needs no context of its own. */
export interface MailNotifyCardFace {
  readonly card: MailNotifyCard
}

/** A staged draft: text, or `null` for a staged clear. */
type Draft = string | null

/** The fields a provider preset fills in. Editing any of them by hand ends "auto-filled". */
const ENDPOINT_FIELDS = new Set(['smtpHost', 'smtpPort', 'smtpSecure'])

/** The question-notification switch. */
const QUESTIONS_FIELD = fieldDef('notifyQuestions')

/** The approval-notification switch. */
const APPROVALS_FIELD = fieldDef('notifyApprovals')

/**
 * Read one field of a section with the schema default filled in.
 *
 * The form's resolved section already carries schema defaults on a real Host;
 * the fallback matters only for a section that omits the field.
 *
 * @param section - the resolved section.
 * @param def - the field.
 * @returns the value in effect.
 */
function savedValue(section: Section, def: FieldDef): unknown {
  const value = section[def.field]
  return value === undefined || value === null ? def.fallback : value
}

/**
 * Whether a resolved boolean reads as on.
 *
 * @param section - the resolved section.
 * @param def - the switch.
 * @returns whether it is on.
 */
function isOn(section: Section, def: FieldDef | undefined): boolean {
  return def !== undefined && savedValue(section, def) === true
}

/**
 * The card's controller.
 *
 * Constructed inside the client plugin's effect, so the form binding and the
 * credential-invalidation subscription are released with the plugin.
 */
export class MailNotifyCard {
  private readonly ctx: ClientContext
  private readonly form: ConfigForm<Section>
  private readonly listeners = new Set<() => void>()
  private readonly staged = new Map<string, Draft>()
  private readonly disposers: Array<() => void> = []
  /** The last projection, cached so `getSnapshot` keeps a stable reference. */
  private snapshot: CardState
  private secretDraft = ''
  private credential: CredentialFacts = { configured: false, writable: false }
  private credentialKnown = false
  private status: StatusValue | undefined
  private notice: LocalizedMessage | undefined
  private saving = false
  private failed = false
  private testing = false
  private testEmail: TestEmailState | undefined
  /** Set when typing a username filled the endpoint in; cleared by any edit of it. */
  private autoFilled: string | undefined

  /**
   * @param ctx - the client root context.
   */
  constructor(ctx: ClientContext) {
    this.ctx = ctx
    // The Host's own form for this entry. `configForms.get` is addressed by the
    // profile entry id, which is the same string the Host's Config schema is
    // reachable under and the same one the bundle patch row declares.
    this.form = ctx.configForms.get<Section>(SETTINGS_NAMESPACE)
    this.snapshot = this.project()

    const offForm = this.form.subscribe(() => {
      // The host document moved. Staged drafts are the user's and survive: a
      // concurrent write from another surface must not silently discard what
      // this form is holding.
      this.publish()
    })
    const offCredentials = onCredentialUpdated(ctx, (ref) => {
      if (ref !== this.credentialRef()) return
      void this.refresh()
    })
    this.disposers.push(offForm, offCredentials)

    void this.refresh()
  }

  /** @returns the current projection (stable reference until the next change). */
  getSnapshot(): CardState {
    return this.snapshot
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Release the form subscription and the invalidation subscription. */
  dispose(): void {
    for (const disposer of this.disposers.splice(0)) disposer()
    this.listeners.clear()
  }

  /**
   * Stage one field's draft text.
   * @param field - the field name.
   * @param text - the control's new text.
   */
  edit(field: string, text: string): void {
    this.staged.set(field, text)
    this.notice = undefined
    if (ENDPOINT_FIELDS.has(field)) this.autoFilled = undefined
    if (field === 'smtpUser') this.fillEndpointFromUser(text)
    this.publish()
  }

  /**
   * Fill the server, port, and encryption in from a username at a known
   * provider — but only while the server is empty, so nothing the person typed
   * or saved is ever overwritten behind their back. A filled-in server that
   * disagrees is surfaced as a suggestion instead (see `suggestedProvider`).
   *
   * @param user - the username draft.
   */
  private fillEndpointFromUser(user: string): void {
    const preset = presetForAddress(user)
    if (preset === undefined) return
    if (this.textAfterSave('smtpHost').trim() !== '') return
    this.stagePreset(preset.id)
    this.autoFilled = preset.id
  }

  /**
   * The text a field will hold once the staged drafts are saved, as the page
   * would render it.
   *
   * @param field - the field name.
   * @returns the text, `''` for an empty field.
   */
  private textAfterSave(field: string): string {
    const def = fieldDef(field)
    if (def === undefined) return ''
    const staged = this.staged.get(field)
    if (typeof staged === 'string') return staged
    const scope = this.form.getSnapshot()
    if (staged === null) {
      const base = (typeof scope.base === 'object' && scope.base !== null ? scope.base : {}) as Section
      return formatField(def, base[field] ?? def.fallback)
    }
    return formatField(def, ((scope.value ?? {}) as Section)[field])
  }

  /**
   * Stage one preset's endpoint.
   *
   * @param id - the preset id.
   * @returns whether the id named a preset.
   */
  private stagePreset(id: string): boolean {
    const preset = SMTP_PRESETS.find((entry) => entry.id === id)
    if (preset === undefined) return false
    this.staged.set('smtpHost', preset.host)
    this.staged.set('smtpPort', String(preset.port))
    this.staged.set('smtpSecure', preset.secure ? 'true' : 'false')
    return true
  }

  /**
   * Stage a clear for one field, so saving lets it re-inherit the composition layer.
   * @param field - the field name.
   */
  resetField(field: string): void {
    this.staged.set(field, null)
    if (ENDPOINT_FIELDS.has(field)) this.autoFilled = undefined
    this.notice = undefined
    this.publish()
  }

  /**
   * Stage a clear for every field the namespace owns.
   *
   * Staged rather than written: a reset is destructive and a Save press is the
   * confirmation. The write it performs is an `unset` of each field, which is
   * what "reset" means here — the user layer loses its entries and the
   * composition layer and schema defaults take over again.
   */
  resetAll(): void {
    for (const def of ALL_FIELDS) this.staged.set(def.field, null)
    this.autoFilled = undefined
    this.notice = { key: 'noticeResetStaged' }
    this.publish()
  }

  /** Drop every staged edit. */
  discard(): void {
    this.staged.clear()
    this.autoFilled = undefined
    this.secretDraft = ''
    this.notice = undefined
    this.failed = false
    this.publish()
  }

  /**
   * Stage the credential control's draft.
   *
   * The text lives here and nowhere else until it is written: it is never
   * seeded from the host, never put in a snapshot field the card renders back,
   * and never logged.
   *
   * @param text - the typed secret.
   */
  setSecretDraft(text: string): void {
    this.secretDraft = text
    this.notice = undefined
    this.publish()
  }

  /**
   * Stage the server, port, and encryption of one common mail provider.
   *
   * Staged like any other edit, so the person sees the three values change and
   * nothing is written until Save.
   *
   * @param id - the preset id from {@link SMTP_PRESETS}.
   */
  applyPreset(id: string): void {
    if (!this.stagePreset(id)) return
    this.autoFilled = undefined
    // The sender must be the signed-in mailbox at every listed provider, so an
    // empty sender follows the username. A sender already there is left alone.
    const user = this.textAfterSave('smtpUser').trim()
    if (user !== '' && this.textAfterSave('from').trim() === '') this.staged.set('from', user)
    this.notice = undefined
    this.publish()
  }

  /**
   * Stage the sender address as a copy of the user name, which is what almost
   * every provider requires it to be.
   */
  useUsernameAsSender(): void {
    const user = this.snapshot.fields.find((entry) => entry.def.field === 'smtpUser')
    const text = user === undefined ? '' : user.pendingReset ? user.defaultText : user.text
    if (text.trim() === '') return
    this.edit('from', text.trim())
  }

  /**
   * Write every staged edit, then the credential, then re-seed.
   *
   * The order is not arbitrary. The credential is addressed by the reference
   * the section names, so a save that changes the reference and the password
   * together must store the section first and read the reference back before
   * writing the secret; the other order would store the password under the
   * reference the user just replaced.
   */
  async save(): Promise<void> {
    if (this.saving) return
    const current = this.snapshot
    if (current.invalid) {
      this.notice = { key: 'noticeFixInvalid' }
      this.publish()
      return
    }
    if (!current.dirty) {
      this.notice = { key: 'noticeNothingToSave' }
      this.publish()
      return
    }
    if (current.missingRequired.length > 0) {
      // The Host refuses an enabled configuration without these fields, so the
      // save could only come back refused — in English, after a round trip, and
      // naming a schema path. Saying it here, in the page's language and next to
      // the marked fields, is the same verdict delivered usefully.
      this.notice = { key: 'noticeFillRequired' }
      this.publish()
      return
    }

    this.saving = true
    this.failed = false
    this.notice = undefined
    this.publish()

    const ops = this.planOps()
    let ok = true
    let message: string | undefined

    if (ops.length > 0) {
      // The fence is the revision the form currently stands at. `mutate` is one
      // atomic namespace mutation, so the document moves by one revision and a
      // partial application is not a state it can reach.
      const revision = this.form.getSnapshot().revision
      try {
        const accepted = await this.form.mutate(ops, revision)
        if (!accepted) {
          ok = false
          message = undefined
        }
      } catch (error) {
        ok = false
        message = error instanceof Error ? error.message : String(error)
      }
    }

    if (ok && this.secretDraft !== '') {
      const ref = this.credentialRef()
      const written = await setCredential(this.ctx, ref, this.secretDraft)
      if (written.ok) {
        // Clear the draft only once the host has accepted the value. A refused
        // write keeps the draft so the user can correct it instead of retyping,
        // and nothing else ever reads this field back.
        this.secretDraft = ''
      } else {
        ok = false
        message = written.message
      }
    }

    if (ok) {
      this.staged.clear()
      this.autoFilled = undefined
    }
    this.saving = false
    this.failed = !ok
    if (!ok) {
      this.notice =
        message === undefined ? { key: 'noticeSaveRefusedDefault' } : { key: 'noticeSaveRefused', params: { message } }
    } else if (this.secretDraft === '') this.notice = { key: 'noticeSaved' }

    await this.refresh()
    this.publish()
  }

  /**
   * Ask the host to deliver a test message.
   *
   * Sent through the same credential and transport path a real notification
   * takes, so a success here is evidence about the notification path and not
   * merely about connectivity.
   */
  async sendTestEmail(): Promise<void> {
    if (this.testing) return
    this.testing = true
    this.notice = undefined
    this.publish()

    const outcome = await requestTestEmail(this.ctx)
    this.testing = false
    this.testEmail = outcome.ok
      ? {
          delivered: outcome.value.delivered,
          recipientCount: outcome.value.recipientCount,
          message: outcome.value.delivered
            ? {
                key: 'testEmailSent',
                params: { count: outcome.value.recipientCount },
              }
            : outcome.value.message === undefined
              ? { key: 'testEmailRefused' }
              : {
                  key: 'testEmailServerMessage',
                  params: { message: outcome.value.message },
                },
        }
      : {
          delivered: false,
          recipientCount: 0,
          message: {
            key: 'testEmailFailed',
            params: { message: outcome.message },
          },
        }
    await this.refresh()
    this.publish()
  }

  /**
   * Remove the stored password for the reference currently in effect.
   *
   * A removal rather than a write of the empty string: the credentials domain
   * has no "blank value" state, and storing one would leave the reference
   * configured with a password that cannot authenticate. Afterwards the
   * reference re-inherits whatever the deployment's other sources supply.
   */
  async clearCredential(): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.notice = undefined
    this.publish()

    const outcome = await unsetCredential(this.ctx, this.credentialRef())
    this.saving = false
    this.failed = !outcome.ok
    if (!outcome.ok)
      this.notice = {
        key: 'noticeCredentialRefused',
        params: { message: outcome.message },
      }
    else {
      this.secretDraft = ''
      this.notice = { key: 'noticeCredentialRemoved' }
    }

    await this.refresh()
    this.publish()
  }

  /** Re-read the credential state and the host's live runtime facts. */
  async refresh(): Promise<void> {
    const ref = this.credentialRef()
    const [credential, status] = await Promise.all([describeCredential(this.ctx, ref), readRuntimeStatus(this.ctx)])
    if (credential.ok) {
      this.credential = credential.value
      this.credentialKnown = true
    } else {
      this.credentialKnown = true
      this.credential = { configured: false, writable: false }
    }
    if (status.ok) this.status = status.value
    this.publish()
  }

  /** The credential reference currently in effect. */
  private credentialRef(): string {
    const section = this.form.getSnapshot().value
    return credentialRefFrom(section?.[CREDENTIAL_REF_FIELD.field])
  }

  /**
   * Build the ordered write a save performs.
   *
   * One atomic mutation carries every field, so the namespace moves by one
   * revision and a partial application is not a state the document can reach.
   * @returns the path operations, in the order the fields were staged.
   */
  private planOps(): SettingsPathOpView[] {
    const ops: SettingsPathOpView[] = []
    for (const [field, draft] of this.staged) {
      if (draft === null) {
        ops.push({ op: 'unset', path: [field] })
        continue
      }
      const def = fieldDef(field)
      if (def === undefined) continue
      const parsed = parseField(def, draft)
      if (parsed.kind === 'clear') ops.push({ op: 'unset', path: [field] })
      else if (parsed.kind === 'value') ops.push({ op: 'set', path: [field], value: parsed.value as never })
    }
    return ops
  }

  /** Rebuild the projection and notify every listener. */
  private publish(): void {
    const next = this.project()
    this.snapshot = next
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A listener is a React re-render. One that throws must not stop the
        // others from being told, and must not escape into the save path.
      }
    }
  }

  /** Build one projection of the form and the staged drafts. */
  private project(): CardState {
    const scope: ConfigFormSnapshot<Section> = this.form.getSnapshot()
    const section = (scope.value ?? {}) as Section
    const user = (scope.user ?? undefined) as Section | undefined
    const base = (typeof scope.base === 'object' && scope.base !== null ? scope.base : {}) as Section

    /** What a removed override reverts to: the composition layer, else the schema default. */
    const defaultOf = (def: FieldDef): unknown =>
      Object.prototype.hasOwnProperty.call(base, def.field) && base[def.field] !== undefined ? base[def.field] : def.fallback

    /** The value a field would hold once the staged drafts are saved. */
    const afterSave = (def: FieldDef): unknown => {
      const staged = this.staged.get(def.field)
      if (staged === undefined) return savedValue(section, def)
      if (staged === null) return defaultOf(def)
      const parsed = parseField(def, staged)
      if (parsed.kind === 'value') return parsed.value
      if (parsed.kind === 'clear') return defaultOf(def)
      // A refused draft is reported by the parser; for presence it still counts
      // as something typed, so the field is not flagged as empty as well.
      return staged
    }

    const enabledAfterSave = afterSave(ENABLED_FIELD) !== false
    const missingRequired = enabledAfterSave
      ? ALL_FIELDS.filter((def) => def.required === true && !isFilled(def, afterSave(def))).map((def) => def.field)
      : []

    let invalid = false
    const fields = ALL_FIELDS.map((def): FieldState => {
      const staged = this.staged.get(def.field)
      const overriddenByUser = user !== undefined && Object.prototype.hasOwnProperty.call(user, def.field)
      const defaultText = formatField(def, defaultOf(def))
      const required = def.required === true && enabledAfterSave
      const missing = missingRequired.includes(def.field)
      if (staged === null) {
        // A staged clear answers for itself: the badge previews the save.
        return {
          def,
          text: '',
          overridden: false,
          invalid: false,
          issue: undefined,
          defaultText,
          pendingReset: true,
          required,
          missing,
        }
      }
      if (staged !== undefined) {
        const parsed = parseField(def, staged)
        const bad = parsed.kind === 'invalid'
        if (bad) invalid = true
        return {
          def,
          text: staged,
          overridden: true,
          invalid: bad,
          issue: parsed.kind === 'invalid' ? parsed.issue : undefined,
          defaultText,
          pendingReset: false,
          required,
          missing,
        }
      }
      return {
        def,
        text: formatField(def, section[def.field]),
        overridden: overriddenByUser,
        invalid: false,
        issue: undefined,
        defaultText,
        pendingReset: false,
        required,
        missing,
      }
    })

    const dirty = this.staged.size > 0 || this.secretDraft !== ''

    const portDef = fieldDef('smtpPort')
    const secureDef = fieldDef('smtpSecure')
    const port = portDef === undefined ? undefined : afterSave(portDef)
    const secure = secureDef === undefined ? undefined : afterSave(secureDef)
    const portMismatch: PortSecurityMismatch | undefined =
      port === 465 && secure === false ? 'port465StartTls' : port === 587 && secure === true ? 'port587Tls' : undefined

    const hostDef = fieldDef('smtpHost')
    const userDef = fieldDef('smtpUser')
    const hostAfter = hostDef === undefined ? undefined : afterSave(hostDef)
    const provider = presetForHost(hostAfter)?.id
    const userProvider = userDef === undefined ? undefined : presetForAddress(afterSave(userDef))?.id
    const hostFilled = typeof hostAfter === 'string' && hostAfter.trim() !== ''
    const suggestedProvider = userProvider !== undefined && hostFilled && userProvider !== provider ? userProvider : undefined
    // "Auto-filled" lasts only while the server still is what was filled in.
    const autoFilledProvider = this.autoFilled !== undefined && this.autoFilled === provider ? this.autoFilled : undefined

    const filled = (name: string): boolean => {
      const def = fieldDef(name)
      return def !== undefined && isFilled(def, savedValue(section, def))
    }

    return {
      available: scope.status !== 'unavailable',
      loading: scope.status === 'loading',
      writable: scope.writable,
      dirty,
      invalid,
      saving: this.saving,
      failed: this.failed,
      fields,
      questionsOn: isOn(section, QUESTIONS_FIELD),
      approvalsOn: isOn(section, APPROVALS_FIELD),
      enabled: savedValue(section, ENABLED_FIELD) !== false,
      activeEvents: EVENT_SWITCHES.filter((def) => isOn(section, def)).map((def) => def.field),
      setup: {
        server: filled('smtpHost'),
        account: filled('smtpUser') && this.credential.configured,
        addresses: filled('from') && filled('to'),
        tested: this.testEmail?.delivered === true,
      },
      missingRequired,
      portMismatch,
      provider,
      suggestedProvider,
      autoFilledProvider,
      credentialRef: credentialRefFrom(section[CREDENTIAL_REF_FIELD.field]),
      secret: {
        draft: this.secretDraft,
        configured: this.credential.configured,
        writable: this.credential.writable,
        known: this.credentialKnown,
      },
      status: this.status,
      notice: this.notice,
      testing: this.testing,
      testEmail: this.testEmail,
    }
  }
}

/** The card's queue facts, or `undefined` before the first status read. */
export function queueOf(status: StatusValue | undefined): QueueStatusValue | undefined {
  return status?.queue
}
