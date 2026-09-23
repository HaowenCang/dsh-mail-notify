/**
 * The card's controller: staged drafts over one settings namespace, plus the
 * actions that write them.
 *
 * Two stores sit underneath and they must not be conflated. The settings scope
 * is the *host's* state — a revision-fenced document this card only reads — and
 * the staged map is the *user's* pending intent. The rendered snapshot is a
 * projection of both, rebuilt whenever either moves, and it is published
 * through one `getSnapshot`/`subscribe` pair so the card can read it with
 * `useSyncExternalStore`.
 *
 * A field shows its effective value and separately whether the user layer
 * carries it. Presence, not a value comparison, is what marks a field
 * overridden: an override equal to the composition default is still an
 * override, and comparing values could not see it. That is also what makes
 * Reset meaningful — a reset is the *removal* of a user-layer entry, so the
 * field re-inherits the composition layer rather than being written to a copy
 * of it.
 *
 * @module dsh-mail-notify/client/card
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { SETTINGS_NAMESPACE, type QueueStatusValue, type StatusValue } from '../protocol.ts'
import type { ClientContext, SettingsScope } from './contracts.ts'
import {
  ALL_FIELDS,
  CREDENTIAL_REF_FIELD,
  credentialRefFrom,
  formatField,
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

/** Everything the card renders, as one immutable projection. */
export interface CardState {
  /** False while the host does not serve this namespace; the card renders nothing. */
  readonly available: boolean
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

/** The question-notification switch — the one field the collapsed summary reports. */
const QUESTIONS_FIELD = ALL_FIELDS.find((entry) => entry.field === 'notifyQuestions')

/** The approval-notification switch — the expanded status strip's second effective line. */
const APPROVALS_FIELD = ALL_FIELDS.find((entry) => entry.field === 'notifyApprovals')

/**
 * The card's controller.
 *
 * Constructed inside the client plugin's effect, so the bound settings scope
 * and the credential-invalidation subscription are released with the plugin.
 */
export class MailNotifyCard {
  private readonly ctx: ClientContext
  private readonly scope: SettingsScope<Section>
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

  /**
   * @param ctx - the client root context.
   */
  constructor(ctx: ClientContext) {
    this.ctx = ctx
    this.scope = ctx.settingsScope.bind<Section>({ namespace: SETTINGS_NAMESPACE })
    this.snapshot = this.project()

    const offScope = this.scope.subscribe(() => {
      // The host document moved. Staged drafts are the user's and survive: a
      // concurrent write from another surface must not silently discard what
      // this form is holding.
      this.publish()
    })
    const offCredentials = onCredentialUpdated(ctx, (ref) => {
      if (ref !== this.credentialRef()) return
      void this.refresh()
    })
    this.disposers.push(offScope, offCredentials)

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

  /** Release the scope binding and the invalidation subscription. */
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
    this.publish()
  }

  /**
   * Stage a clear for one field, so saving lets it re-inherit the composition layer.
   * @param field - the field name.
   */
  resetField(field: string): void {
    this.staged.set(field, null)
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
    this.notice = { key: 'noticeResetStaged' }
    this.publish()
  }

  /** Drop every staged edit. */
  discard(): void {
    this.staged.clear()
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

    this.saving = true
    this.failed = false
    this.notice = undefined
    this.publish()

    const ops = this.planOps()
    let ok = true
    let message: string | undefined

    if (ops.length > 0) {
      const revision = this.scope.getSnapshot().revision
      try {
        await this.scope.mutate(ops, revision)
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

    if (ok) this.staged.clear()
    this.saving = false
    this.failed = !ok
    if (!ok) {
      this.notice =
        message === undefined
          ? { key: 'noticeSaveRefusedDefault' }
          : { key: 'noticeSaveRefused', params: { message } }
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
            ? { key: 'testEmailSent', params: { count: outcome.value.recipientCount } }
            : outcome.value.message === undefined
              ? { key: 'testEmailRefused' }
              : { key: 'testEmailServerMessage', params: { message: outcome.value.message } },
        }
      : { delivered: false, recipientCount: 0, message: { key: 'testEmailFailed', params: { message: outcome.message } } }
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
    if (!outcome.ok) this.notice = { key: 'noticeCredentialRefused', params: { message: outcome.message } }
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
    const [credential, status] = await Promise.all([
      describeCredential(this.ctx, ref),
      readRuntimeStatus(this.ctx),
    ])
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
    const section = this.scope.getSnapshot().value
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
      const def = ALL_FIELDS.find((entry) => entry.field === field)
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

  /** Build one projection of the scope and the staged drafts. */
  private project(): CardState {
    const scope = this.scope.getSnapshot()
    const section = (scope.value ?? {}) as Section
    const user = (scope.user ?? undefined) as Section | undefined

    let invalid = false
    const fields = ALL_FIELDS.map((def): FieldState => {
      const staged = this.staged.get(def.field)
      const overriddenByUser = user !== undefined && Object.prototype.hasOwnProperty.call(user, def.field)
      if (staged === null) {
        // A staged clear answers for itself: the badge previews the save.
        return { def, text: '', overridden: false, invalid: false, issue: undefined }
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
        }
      }
      return {
        def,
        text: formatField(def, section[def.field]),
        overridden: overriddenByUser,
        invalid: false,
        issue: undefined,
      }
    })

    const dirty = this.staged.size > 0 || this.secretDraft !== ''

    return {
      available: scope.status !== 'unavailable',
      writable: scope.writable,
      dirty,
      invalid,
      saving: this.saving,
      failed: this.failed,
      fields,
      questionsOn:
        QUESTIONS_FIELD !== undefined && formatField(QUESTIONS_FIELD, section[QUESTIONS_FIELD.field]) === 'true',
      approvalsOn:
        APPROVALS_FIELD !== undefined && formatField(APPROVALS_FIELD, section[APPROVALS_FIELD.field]) === 'true',
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
