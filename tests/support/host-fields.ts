/**
 * The Host Config's own field set, derived rather than restated.
 *
 * Two invariants in this repository are statements about *both* halves of the
 * configuration surface at once — that the Web card renders a control for every
 * field the Host Config declares (`FLD-01`), and that the schema the card edits
 * is the checked one (`CFG-11`, `CFG-13`). Written against a handwritten list of
 * field names, each of those tests would pass while both halves drifted
 * together, and the drift they exist to catch is exactly a Host field the Web
 * form never exposes.
 *
 * The projection used here is the one the Host itself walks. `Config.toJSON()`
 * serializes a Schemastery object as a `{ uid, refs }` table whose `refs` are
 * keyed by numeric uid, and the root node's `dict` maps each **field name** to
 * the uid of its node — which is how `dsh-settings`'s form projection recovers
 * field names from the same table. Reading that pair is therefore a statement
 * about the form DSH renders, not about the schema object in memory.
 *
 * @module dsh-mail-notify/tests/support/host-fields
 */

import { Config } from '../../src/config.ts'

/** One node of a serialized Schemastery schema. */
interface SerializedNode {
  type?: string
  meta?: { volatile?: boolean; role?: string }
  /** The root object node's field-name → uid map. */
  dict?: Record<string, number>
}

/** The serialized schema, resolved out of its uid table. */
interface SerializedSchema {
  uid: number
  refs: Record<number, SerializedNode>
}

/** One field the Host Config declares. */
export interface HostField {
  /** The key inside the `dsh-mail-notify` settings section. */
  readonly field: string
  /** Whether the field is a `Volatile` reference, so a Web edit applies live. */
  readonly volatile: boolean
}

/**
 * The complete field set of the exported `Config`, in schema declaration order.
 *
 * Declaration order is not guaranteed by Schemastery, so nothing here relies on
 * it; the callers compare sets.
 *
 * @returns one entry per Config field, or throws when the schema's serialized
 *   shape is not the `{ uid, refs }` table this projection expects — a silent
 *   empty result would turn every caller's comparison into a vacuous pass.
 */
export function hostConfigFields(): HostField[] {
  const serialized = Config.toJSON() as unknown as SerializedSchema
  const root = serialized.refs[serialized.uid]
  const dict = root?.dict
  if (dict === undefined) {
    throw new Error('Config.toJSON() no longer serializes the root object as a refs table with a dict')
  }
  return Object.entries(dict).map(([field, uid]) => {
    const node = serialized.refs[uid]
    if (node === undefined) {
      throw new Error(`Config.toJSON() carries no node for ${field} (uid ${uid})`)
    }
    return { field, volatile: node.meta?.volatile === true }
  })
}

/**
 * The names of every field the Host Config declares.
 *
 * @returns the field names, as the Host's own form projection recovers them.
 */
export function hostConfigFieldNames(): string[] {
  return hostConfigFields().map((entry) => entry.field)
}

/**
 * The named members of the Web card's field set.
 *
 * @param definitions - the card's field table, or any slice of it.
 * @returns the `field` of each definition, in table order.
 */
export function webFieldNames(definitions: readonly { readonly field: string }[]): string[] {
  return definitions.map((definition) => definition.field)
}

/**
 * Build the key-set equality assertion both parity tests make.
 *
 * The two directions are reported separately so a failure names which half is
 * wrong: a Host field the Web form omits is a control the operator cannot
 * reach, while a Web field the Host does not declare is a control that stages a
 * write the Host never accepts.
 *
 * @param host - the Host Config's field names.
 * @param web - the Web card's field names.
 * @returns the fields missing from each side, and any names occurring twice.
 */
export function compareFieldSets(host: readonly string[], web: readonly string[]): {
  missingFromWeb: string[]
  unknownToHost: string[]
  duplicatedInWeb: string[]
  duplicatedInHost: string[]
} {
  const hostSet = new Set(host)
  const webSet = new Set(web)
  const duplicates = (names: readonly string[]): string[] => {
    const seen = new Set<string>()
    const twice = new Set<string>()
    for (const name of names) {
      if (seen.has(name)) twice.add(name)
      seen.add(name)
    }
    return [...twice].sort()
  }
  return {
    missingFromWeb: [...hostSet].filter((name) => !webSet.has(name)).sort(),
    unknownToHost: [...webSet].filter((name) => !hostSet.has(name)).sort(),
    duplicatedInWeb: duplicates(web),
    duplicatedInHost: duplicates(host),
  }
}
