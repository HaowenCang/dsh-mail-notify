/**
 * Two-turn driver for the probe's user-prompt attribution case.
 *
 * ## Why this is a plugin rather than a second task argument
 *
 * The `headless` profile drives exactly one Turn per process: it reads a task,
 * appends it, waits for quiescence, prints the answer, and exits. The property
 * under test — that mail *n* carries prompt *n* — cannot be observed from one
 * Turn, because a single-Turn run has no way to be wrong about which prompt it
 * belongs to. It needs two sequential Turns on one Session, which is exactly
 * what this plugin drives.
 *
 * It replaces the `headless-runner` row for that scenario and nothing else: the
 * Agent, the Session log, the model selection, the provider, the loop, and the
 * plugin under test all take their production paths. The only thing this file
 * owns is *when* the second prompt is appended — after the first Turn reaches
 * quiescence, so the two Turns are sequential rather than concurrent.
 *
 * The prompts are distinct, self-identifying sentinels supplied through the
 * environment. Distinctness is the point: a plugin that attributed the wrong
 * prompt to a turn, or that leaked a pending prompt into the next turn, would
 * still produce two mails and would only be caught by a probe that can tell the
 * two prompts apart from the mail bodies alone.
 *
 * @module dsh-mail-notify/scripts/probe/two-turn-driver
 */

import { appendFileSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'

/** Plugin name; also the loader row id in the probe overlay. */
export const name = 'probe-two-turn-driver'

/**
 * Required services.
 *
 * `agentLoop` is listed deliberately, and it is not redundant with `agents`.
 * `agents` is published by `@deepseek-ai/dsh-agent` and only becomes *usable*
 * once the loop plugin has registered a factory on it; declaring `agents` alone
 * would let this driver run against a service that exists but cannot create
 * anything. Waiting on `agentLoop` as well is what makes "the factory is
 * installed" part of the mount barrier rather than a race the driver happens to
 * lose.
 */
export const inject = ['agents', 'agentLoop', 'agentDefaultModel', 'sessions', 'appExit']

/**
 * Record one stage of the run.
 *
 * Written to a file as well as stderr because the probe captures a child's
 * streams only once it exits: a driver that hung before exiting would leave no
 * evidence of how far it got, and "the probe timed out" is not a diagnosis. The
 * path is the probe's own status directory, so nothing is written anywhere the
 * run does not already own.
 *
 * @param message - the stage description.
 */
function stage(message) {
  const line = `[probe-two-turn] ${message}\n`
  process.stderr.write(line)
  const trace = process.env['PROBE_TWO_TURN_TRACE']
  if (trace === undefined || trace === '') return
  try {
    appendFileSync(trace, `T+${Date.now()} ${message}\n`, 'utf8')
  } catch {
    // An unwritable trace file leaves stderr as the only record; the run
    // continues rather than failing for a diagnostic's sake.
  }
}

/**
 * Read one required environment value.
 *
 * @param key - the variable name.
 * @returns its value.
 * @throws When it is absent or blank, because a probe that silently drove an
 *   empty prompt would produce a passing run that tested nothing.
 */
function required(key) {
  const value = process.env[key]
  if (value === undefined || value.trim() === '') throw new Error(`probe-two-turn-driver: ${key} is required`)
  return value
}

/** One user Turn, appended and awaited to quiescence. */
function userTurn(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/**
 * Drive two sequential Turns on one fresh Session.
 *
 * @param ctx - the plugin's fiber context.
 */
export async function apply(ctx) {
  const firstPrompt = required('PROBE_PROMPT_A')
  const secondPrompt = required('PROBE_PROMPT_B')
  stage('apply entered')

  // The Cordis `inject` list above is the mount barrier, not a `loader.await()`:
  // under DSH 0.1.7 the Loader's settle promise is resolved by the app's own
  // driver reaching its steady state, so a plugin that awaited it while
  // *replacing* that driver would wait for a signal its own predecessor was
  // responsible for producing. `inject` already guarantees `agents`,
  // `agentDefaultModel`, `sessions`, and `appExit` are published before this
  // body runs, which is exactly the guarantee the driver needs.
  stage('services injected')

  const exit = ctx.get('appExit')
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined || exit === undefined) {
    stage('core services are absent; no Turn was driven')
    exit?.(1)
    return
  }

  const selection = defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
  stage(`creating a session in ${cwd} (agentLoop=${ctx.get('agentLoop') === undefined ? 'absent' : 'present'})`)

  const { agent } = await agents.create({
    sessionId: brandString(`probe-two-turn-${Date.now()}`),
    meta: { cwd },
    agentOptions,
  })
  await agent.whenIdle()
  stage('session created and idle')

  for (const [index, prompt] of [firstPrompt, secondPrompt].entries()) {
    stage(`appending prompt ${index + 1}`)
    agent.followup(userTurn(prompt))
    await agent.whenIdle()
    stage(`prompt ${index + 1} reached quiescence`)
  }

  await sessions.flush(agent.session)
  stage('both Turns settled; requesting exit')
  // The probe runs this profile with its one-shot driver disabled, so nothing
  // else will end the process — and a run that never exits would hang the probe
  // rather than fail it. Exiting explicitly is therefore part of this driver's
  // contract, not a convenience.
  exit(0)
}
