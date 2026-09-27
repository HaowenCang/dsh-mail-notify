/**
 * Turn a notification switch on inside a running composition.
 *
 * ## Which half of the write path this drives, and which half it does not
 *
 * A Save in the browser performs two things in sequence: `SettingsForms.mutate`
 * persists the value into the profile's `cordis.patch.yml` through
 * `dsh-config-editor`, and the Loader then reconciles that document into the
 * running tree. The persistence half is exercised by the browser end-to-end run
 * (`V0.4.0_COMPAT_REPORT.md`, "live configuration"); what this probe must prove
 * is the half that decides *behaviour* — that a committed configuration change
 * reaches the running notification engine and changes what mail is sent.
 *
 * That half is the Loader's own volatile commit: `Entry.update` re-resolves the
 * candidate through the plugin's `Config`, compares it to the running fiber with
 * `equalExceptVolatile`, calls `updateVolatile` on each changed reference, and
 * emits `loader/volatile-update`. Calling it here is therefore not a shortcut
 * around the mechanism under test — it *is* the mechanism, entered one step later
 * than the browser enters it, at the point where the profile document has already
 * been written.
 *
 * ## Why not `ctx.settings.mutate`
 *
 * It was tried first, and it does not complete under the headless profile:
 * `dsh-config-editor`'s write path reconciles the whole profile through the
 * Loader, and the headless template's Loader settles that reconciliation only
 * while its one-shot runner is driving a Turn. This scenario replaces that
 * runner, so the reconcile waits for a signal its own predecessor would have
 * produced. The web profile has no such dependency, which is why the persistence
 * half is proven there.
 *
 * @module dsh-mail-notify/scripts/probe/live-policy
 */

import { appendFileSync, readFileSync } from 'node:fs'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-live-policy'

/**
 * Required services.
 *
 * `loader` is the seam this probe drives; `agents` and `agentLoop` are declared
 * so the change cannot be committed before the composition that will react to it
 * is mounted.
 */
export const inject = ['loader', 'agents', 'agentLoop']

/** Where the policy trace goes; absent means the plugin records nothing. */
const tracePath = process.env['PROBE_POLICY_TRACE']

/** The profile entry the plugin's configuration lives under. */
const ENTRY_ID = 'dsh-mail-notify'

/** The switch this scenario turns on. */
const SWITCH = 'notifyQuestions'

/**
 * Record one stage of the run.
 *
 * Written to a file as well as stderr because the probe captures a child's
 * streams only once it exits: a hang would otherwise leave no evidence of how
 * far the run got.
 *
 * @param message - the stage description.
 */
function stage(message) {
  const line = `[probe-live-policy] ${message}\n`
  process.stderr.write(line)
  if (tracePath === undefined || tracePath === '') return
  try {
    appendFileSync(tracePath, `T+${Date.now()} ${message}\n`, 'utf8')
  } catch {
    // An unwritable trace leaves stderr as the only record.
  }
}

/**
 * Wait for one line to appear in a trace file.
 *
 * Polling the driver's own trace is deliberate: the alternative — a timer —
 * would make the ordering a guess, and the assertion this scenario exists for is
 * precisely about ordering.
 *
 * @param file - the trace file to watch.
 * @param needle - the line fragment to wait for.
 * @param timeoutMs - how long to wait.
 * @returns whether the fragment was seen.
 */
async function waitFor(file, needle, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if (readFileSync(file, 'utf8').includes(needle)) return true
    } catch {
      // The writer may not have created the file yet.
    }
    if (Date.now() > deadline) return false
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
}

/**
 * Turn the switch on through the Loader, and report the outcome.
 *
 * @param ctx - the plugin's fiber context.
 */
export async function apply(ctx) {
  const driverTrace = process.env['PROBE_TWO_TURN_TRACE']
  if (driverTrace === undefined || driverTrace === '') {
    stage('no driver trace path was supplied; no change was made')
    return
  }

  // The second Turn is appended by the driver only after the first settles, so
  // this waits for that boundary before writing. Writing earlier would still be a
  // valid configuration change; it would just make the first question's
  // suppression a race rather than a fact.
  if (!(await waitFor(driverTrace, 'prompt 1 reached quiescence'))) {
    stage('the first Turn did not settle in time; the switch was not changed')
    return
  }
  stage('first Turn settled; committing the switch through the Loader')

  const entry = [...ctx.loader.entries()].find((candidate) => candidate.options.id === ENTRY_ID)
  if (entry === undefined) {
    stage(`no loader entry named ${ENTRY_ID} is composed; the switch was not changed`)
    return
  }

  // The candidate is the entry's current raw config with one field changed. It is
  // written as plain data because that is what a profile patch holds: the volatile
  // references are the *resolved* form, and the Loader re-resolves this candidate
  // through the plugin's own schema before it commits anything.
  const next = { ...(entry.options.config ?? {}), [SWITCH]: true }
  try {
    await entry.update({ config: next })
    stage(`switch-on-committed ${SWITCH}=true`)
  } catch (error) {
    stage(`switch-on-failed ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  if (!(await waitFor(driverTrace, 'prompt 2 reached quiescence'))) {
    stage('the second Turn did not settle in time')
    return
  }
  stage('second Turn settled; the live change has been exercised')
}
