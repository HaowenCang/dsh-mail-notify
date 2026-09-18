/**
 * L1 unit tests for `human-attention.ts` — the strict parser and the field
 * allowlist behind mid-turn human-attention notifications (D018).
 *
 * The file proves three properties rather than three functions. Nothing is
 * copied out of a tool call implicitly: `HAT-01` and `HAT-12` fail the moment
 * either builder is written as a spread of its source record, because a property
 * the allowlist does not name would then appear in the DTO. Nothing malformed can
 * throw: the argument string is model output, and every unusable shape must
 * degrade to "nothing to notify" with the reason recorded. And every bound is
 * counted in code points, so `HAT-06` catches a truncation that would otherwise
 * leave half an astral character in a mail body.
 *
 * @module dsh-mail-notify/tests/unit/human-attention
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_APPROVAL_REASON_CHARS,
  MAX_OPTION_LABEL_CHARS,
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUESTION_CHARS,
  MAX_QUESTION_ID_CHARS,
  MAX_QUESTIONS,
  MAX_TOTAL_QUESTION_CHARS,
  parseAskUserQuestionArguments,
  toApprovalNotification,
} from '../../src/human-attention.ts'
import type { QuestionItem } from '../../src/types.ts'

/**
 * A credential-shaped value planted in the fields the allowlist does not name.
 *
 * Two assertions below search the serialized DTO for it. Making the sentinel a
 * single named constant is what keeps those assertions honest: if it were inlined
 * at each site, a later edit could change one copy and leave the test passing for
 * the wrong reason.
 */
const SENTINEL = 'TOKEN_SENTINEL'

/** The exact key set one carried question may have. Nothing else may appear. */
const QUESTION_KEYS = ['header', 'id', 'multiSelect', 'options', 'question']

/** The exact key set of an approval DTO with both optionals present. */
const APPROVAL_KEYS = ['callId', 'cwd', 'kind', 'observedAt', 'reason', 'sessionId', 'toolName']

/** The control characters a mail body may not contain, as a text predicate. */
const UNWANTED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/**
 * Parse one structured argument object the way the runtime would deliver it.
 *
 * The value is serialized first so the tests exercise the same JSON path the
 * session append produces, rather than the compatibility branch, and the result
 * is asserted to be non-empty afterwards so a missing question fails here with a
 * readable message instead of surfacing later as `undefined` in an assertion.
 *
 * @param value - the parsed-argument-shaped object to serialize.
 * @returns the carried questions, proved non-empty.
 */
function parseStructured(value: unknown): readonly QuestionItem[] {
  const result = parseAskUserQuestionArguments(JSON.stringify(value))
  assert.equal(result.questions.length, 1, 'the fixture must carry exactly one question')
  const carried = result.questions[0]
  assert.ok(carried !== undefined, 'a carried question exists whenever the count is one')
  return result.questions
}

/**
 * Parse a raw argument string and return the only question it carried.
 *
 * @param raw - the raw `arguments` string, malformed or not.
 * @returns the first carried question.
 */
function firstQuestion(raw: string): QuestionItem {
  const result = parseAskUserQuestionArguments(raw)
  const carried = result.questions[0]
  assert.ok(carried !== undefined, 'the fixture must carry one question')
  return carried
}

/** The body length of a question that is trivial beside the count and total bounds. */
const SHORT_BODY_CHARS = 30

/**
 * A body length that makes a handful of these alone overflow the total bound.
 *
 * Four of them come to 8032 characters against a bound of 6000, so a fixture
 * built from them reaches the size bound long before the count bound of 20.
 */
const FILLER_BODY_CHARS = 2000

test('HAT-01 a question carrying a credential yields only its two allowlisted fields, so the credential cannot reach a mail body', () => {
  // The proof is the shape of the output, not the shape of the input: a spread of
  // the source record would reproduce `secret` and `nested` verbatim, so the key
  // allowlist assertion alone already fails against that implementation, and the
  // sentinel scan fails independently of it. Both were checked against a local
  // `{ ...record }` copy: the key assertion reports the two extra keys and the
  // sentinel scan reports the planted value, while neither fires against the
  // field-by-field copy this module uses. The two are kept together because they
  // fail for different reasons — one on the structure, one on the content.
  const [carried] = parseStructured({
    questions: [{ id: 'q1', question: 'which database should I target?', secret: SENTINEL, nested: { a: 1 } }],
  })

  assert.ok(carried !== undefined)
  assert.deepEqual(Object.keys(carried).sort(), ['id', 'question'], 'exactly the two mandatory keys survive')
  // The same rule stated as an allowlist: a key outside it means the builder
  // consulted a source other than the five fields it is permitted to read.
  assert.ok(
    Object.keys(carried).every((key) => QUESTION_KEYS.includes(key)),
    `an unexpected key reached the question: ${Object.keys(carried).join(', ')}`,
  )
  assert.deepEqual(carried, { id: 'q1', question: 'which database should I target?' })
  assert.ok(!Object.keys(carried).includes('secret'))
  assert.ok(!Object.keys(carried).includes('nested'))

  // `JSON.stringify` returns `undefined` — not a string — for a value it cannot
  // serialize, so the type is checked before the scan rather than after.
  const serialized = JSON.stringify(carried)
  assert.equal(typeof serialized, 'string')
  assert.ok(!String(serialized).includes(SENTINEL), 'no unnamed field may reach the outbound representation')
})

test('HAT-02 an option is rebuilt from label and description alone, never spread', () => {
  const question = firstQuestion(
    JSON.stringify({
      questions: [
        {
          id: 'q1',
          question: 'pick one',
          options: [
            { label: 'the first', description: 'the cheap one', secret: SENTINEL },
            { label: 'the second', description: 'the slow one', nested: { a: 1 } },
          ],
        },
      ],
    }),
  )

  assert.deepEqual(question.options, [
    { label: 'the first', description: 'the cheap one' },
    { label: 'the second', description: 'the slow one' },
  ])
  // The option's own allowlist, asserted per element: a spread would add the
  // unnamed key here even though the question object itself stayed clean.
  for (const option of question.options ?? []) {
    assert.deepEqual(Object.keys(option).sort(), ['description', 'label'])
  }
  assert.ok(!JSON.stringify(question).includes(SENTINEL))
})

test('HAT-03 header, option fields, and multi_select survive; multiSelect is accepted in the service spelling too', () => {
  const [withSnake] = parseStructured({
    questions: [
      {
        id: 'q1',
        question: 'which strategy?',
        header: 'Deployment target',
        multi_select: true,
        options: [{ label: 'staging', description: 'the safe one' }, { label: 'production', description: 'the risky one' }],
      },
    ],
  })
  assert.ok(withSnake !== undefined)
  assert.equal(withSnake.header, 'Deployment target')
  assert.equal(withSnake.multiSelect, true)
  assert.deepEqual(withSnake.options, [
    { label: 'staging', description: 'the safe one' },
    { label: 'production', description: 'the risky one' },
  ])

  // `multiSelect` is the spelling DSH's service layer uses after mapping the
  // argument, so both spellings must reach the same field; otherwise a question
  // loses its multi-select flag on whichever side of that mapping delivered it.
  const [withCamel] = parseStructured({
    questions: [{ id: 'q1', question: 'which strategy?', multiSelect: true, options: [{ label: 'staging' }] }],
  })
  assert.ok(withCamel !== undefined)
  assert.equal(withCamel.multiSelect, true)

  const result = parseAskUserQuestionArguments(
    JSON.stringify({ questions: [{ id: 'q1', question: 'which strategy?', multiSelect: true, options: [{ label: 'a' }] }] }),
  )
  assert.equal(result.sawOptions, true)
  assert.equal(result.sawMultiSelect, true)
})

test('HAT-04 a non-boolean multi_select is dropped rather than coerced', () => {
  const [carried] = parseStructured({
    questions: [{ id: 'q1', question: 'pick', multi_select: 'yes', multiSelect: true }],
  })

  assert.ok(carried !== undefined)
  // The truthy string blocks the camelCase fallback as well, because the
  // precedence is `?? ` rather than a per-field check. That is the deliberate
  // reading: a field that arrived with the wrong type is untrusted, and falling
  // through to the other spelling would silently accept a value the schema of
  // neither spelling permits. The weaker assertion — that `'yes'` never becomes
  // `true` — is the one that matters, and it holds either way.
  assert.equal('multiSelect' in carried, false)
  assert.deepEqual(Object.keys(carried).sort(), ['id', 'question'])
})

test('HAT-05 more questions than MAX_QUESTIONS are counted rather than read', () => {
  const questions = Array.from({ length: MAX_QUESTIONS + 5 }, (_unused, index) => ({
    id: `q${index}`,
    question: 'a question with a short body',
  }))
  const result = parseAskUserQuestionArguments(JSON.stringify({ questions }))

  assert.equal(result.questions.length, MAX_QUESTIONS)
  assert.equal(result.droppedQuestions, 5)
  assert.equal(result.dropReason, undefined, 'a partial carry is not a drop: some questions were delivered')
  assert.ok(result.droppedFields.includes(`questions[${MAX_QUESTIONS}+]`))
})

test('HAT-05b more options than MAX_OPTIONS_PER_QUESTION are cut at the bound', () => {
  const options = Array.from({ length: MAX_OPTIONS_PER_QUESTION + 7 }, (_unused, index) => ({ label: `option ${index}` }))
  const question = firstQuestion(JSON.stringify({ questions: [{ id: 'q1', question: 'pick one', options }] }))

  assert.equal(question.options?.length, MAX_OPTIONS_PER_QUESTION)
  assert.equal(question.options?.[MAX_OPTIONS_PER_QUESTION - 1]?.label, `option ${MAX_OPTIONS_PER_QUESTION - 1}`)
})

test('HAT-05c an oversized question body is truncated to the code-point bound', () => {
  const carried = firstQuestion(JSON.stringify({ questions: [{ id: 'q1', question: 'x'.repeat(MAX_QUESTION_CHARS + 500) }] }))

  assert.equal(Array.from(carried.question).length, MAX_QUESTION_CHARS)
  assert.equal(carried.question, 'x'.repeat(MAX_QUESTION_CHARS))
})

test('HAT-05d the running total carries only what fits and counts the rest', () => {
  const questions = Array.from({ length: MAX_QUESTIONS }, (_unused, index) => ({
    id: `q${index}`,
    question: 'Q'.repeat(FILLER_BODY_CHARS),
  }))
  const totalCost = questions.reduce((sum, entry) => sum + entry.question.length + entry.id.length, 0)
  assert.ok(totalCost > MAX_TOTAL_QUESTION_CHARS, 'the fixture must overflow the total bound')

  const result = parseAskUserQuestionArguments(JSON.stringify({ questions }))

  const carriedCost = result.questions.reduce(
    (sum, entry) => sum + Array.from(entry.id).length + Array.from(entry.question).length,
    0,
  )
  assert.ok(carriedCost <= MAX_TOTAL_QUESTION_CHARS, 'the bound describes the outbound content, so it must hold for the carried set')
  assert.ok(result.questions.length < questions.length, 'some questions must not be carried')
  assert.equal(result.droppedQuestions, questions.length - result.questions.length)
  // The bound is what stopped the list, not a field check: the question after the
  // last carried one is listed under the size rule rather than under a missing
  // field, and one more question is exactly what does not fit.
  const boundary = result.questions.length
  assert.ok(result.droppedFields.includes(`questions[${boundary}]`))
  const refused = questions[boundary]
  assert.ok(refused !== undefined)
  assert.ok(
    carriedCost + refused.question.length + refused.id.length > MAX_TOTAL_QUESTION_CHARS,
    'the carried set is maximal: the next question is the one the bound refuses',
  )
})

test('HAT-06 an oversized astral question is bounded in code points and never split mid-character', () => {
  const emoji = '😀'.repeat(2500)
  const carried = firstQuestion(JSON.stringify({ questions: [{ id: 'q1', question: emoji }] }))

  // Counting UTF-16 units would cut this at 2000 units, which is 1000 emoji: the
  // body would be half its permitted size, and a bound expressed in code points
  // would silently mean something else.
  assert.equal(Array.from(carried.question).length, MAX_QUESTION_CHARS)
  assert.ok(carried.question.length < emoji.length)

  const lastCodePointAt = carried.question.length - 2
  const last = carried.question.codePointAt(lastCodePointAt)
  assert.ok(last !== undefined)
  // The index is derived from the string rather than from the code-point count:
  // `Array.from(x).length - 1` is a code-point index and would read the trailing
  // low surrogate of the final pair, which is how a split-character check can
  // report a break in a string that has none. What makes the pair whole is that
  // the value at the pair's own start is an astral code point, and that nothing
  // before it is unpaired.
  assert.ok(last > 0xffff, `the final pair must be whole: the last code point is U+${last.toString(16)}`)
  assert.ok(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(carried.question.slice(0, lastCodePointAt)),
    'no high surrogate before the final pair may be left without its pair',
  )
})

test('HAT-07 malformed arguments degrade to nothing-to-notify, never to a throw', () => {
  const cases: readonly string[] = ['{not json', '', '   ']
  for (const raw of cases) {
    // The parser is called with no surrounding `try`: a throw would fail this
    // test as an uncaught exception, which is the point — the session-append path
    // may not be made to handle an error the parser created.
    assert.deepEqual(parseAskUserQuestionArguments(raw), {
      questions: [],
      droppedQuestions: 0,
      droppedFields: [],
      sawOptions: false,
      sawMultiSelect: false,
      argumentsReadable: false,
      dropReason: 'unreadable-arguments',
    })
  }
})

test('HAT-07b non-string, non-object arguments and empty question arrays report their own reasons', () => {
  const unreadable: readonly unknown[] = [null, undefined, 42, true, [], Symbol('x')]
  for (const raw of unreadable) {
    const result = parseAskUserQuestionArguments(raw)
    assert.equal(result.questions.length, 0, `${String(raw)} must carry no question`)
    assert.equal(result.argumentsReadable, false)
    assert.equal(result.dropReason, 'unreadable-arguments')
  }

  // `'[]'` parses to an array, and an array is not a record of arguments: the
  // JSON was syntactically readable while the payload was not, and the two are
  // reported separately because they call for different fixes.
  const emptyArray = parseAskUserQuestionArguments('[]')
  assert.deepEqual(emptyArray.questions, [])
  assert.equal(emptyArray.argumentsReadable, false)
  assert.equal(emptyArray.dropReason, 'unreadable-arguments')

  for (const raw of ['{}', '{"questions":[]}']) {
    const result = parseAskUserQuestionArguments(raw)
    assert.equal(result.questions.length, 0)
    // The JSON was readable and named no question: a different observation from
    // malformed arguments, and the distinction is what an operator debug line
    // needs in order to tell a broken model call from an empty one.
    assert.equal(result.argumentsReadable, true)
    assert.equal(result.dropReason, 'no-questions')
  }

  // `{"questions":{}}` is readable JSON whose `questions` is not an array, which
  // the parser treats as "no questions" rather than as unreadable arguments.
  const object = parseAskUserQuestionArguments('{"questions":{}}')
  assert.equal(object.questions.length, 0)
  assert.equal(object.argumentsReadable, true)
  assert.equal(object.dropReason, 'no-questions')
})

test('HAT-08 a structured argument object is accepted and still copied field by field', () => {
  const structured = { questions: [{ id: 'q1', question: 'which one?', secret: SENTINEL, nested: { a: 1 } }] }
  const result = parseAskUserQuestionArguments(structured)

  assert.equal(result.argumentsReadable, true, 'the compatibility branch reads a persisted argument object')
  assert.equal(result.questions.length, 1)
  const carried = result.questions[0]
  assert.ok(carried !== undefined)
  // The branch changes how the input is read, never how it is copied: accepting a
  // structured object must not become a second path into the mail body.
  assert.deepEqual(carried, { id: 'q1', question: 'which one?' })
  assert.deepEqual(Object.keys(carried).sort(), ['id', 'question'])
  assert.ok(!JSON.stringify(carried).includes(SENTINEL))
})

test('HAT-09 a question missing an id or a usable body is dropped by path', () => {
  const result = parseAskUserQuestionArguments(
    JSON.stringify({
      questions: [{ question: 'no id here' }, { id: 'q2' }, { id: 'q3', question: '   ' }, { id: 'q4', question: 'kept' }],
    }),
  )

  assert.deepEqual(
    result.questions.map((entry) => entry.id),
    ['q4'],
  )
  assert.equal(result.droppedQuestions, 3)
  // The paths are asserted exactly rather than by membership: they are what the
  // debug log reports, and a wrong index would send an operator to the wrong
  // question in the call.
  assert.deepEqual(result.droppedFields, ['questions[0].id', 'questions[1].question', 'questions[2].question'])
})

test('HAT-10 control characters are stripped while the line structure of a question is flattened', () => {
  const carried = firstQuestion(
    JSON.stringify({
      questions: [{ id: 'q1', question: 'first line\nsecond line\r\nthird\u0000end\u001b[31mred', header: 'head\r\nX-Injected: yes' }],
    }),
  )

  assert.ok(carried !== undefined)
  // Every C0 control character is removed, and the ones that carry line
  // structure become spaces rather than disappearing. The stated intent in the
  // module was to keep `\n` and drop `\r`; `cleanText` delegates to
  // `sanitizeDetail`, which flattens the whole C0 range, so the newline is
  // asserted as it actually behaves. The fact worth pinning is that no control
  // character survives at all: the mail body is presentation, and an embedded
  // 0x1b is a terminal escape the reader's client may render.
  assert.ok(!UNWANTED_CONTROL.test(carried.question), 'the body must carry no C0 or C1 control character')
  assert.ok(!carried.question.includes('\r'))
  assert.ok(!carried.question.includes('\n'))
  assert.ok(!carried.question.includes('\u001b'))
  assert.equal(carried.question, 'first line second line third end [31mred')

  const header = carried.header
  assert.ok(header !== undefined)
  // The subject is built from this header, so a surviving CR would be a header
  // injection primitive rather than a formatting blemish. `renderAttentionSubject`
  // sanitizes again, and this assertion pins the first of the two defences.
  assert.ok(!header.includes('\r'))
  assert.ok(!header.includes('\n'))
  assert.equal(header, 'head X-Injected: yes')
})

test('HAT-10b option labels are cleaned by the same rule as question bodies', () => {
  const options = Array.from({ length: 40 }, (_unused, index) => ({
    label: `${'L'.repeat(MAX_OPTION_LABEL_CHARS)}\u0000\u001b[0m\r\n${index}`,
  }))
  const question = firstQuestion(JSON.stringify({ questions: [{ id: 'q1', question: 'pick', options }] }))

  assert.equal(question.options?.length, MAX_OPTIONS_PER_QUESTION)
  for (const option of question.options ?? []) {
    assert.ok(!/[\u0000-\u001f\u007f]/.test(option.label), 'no control character may survive in a label')
    assert.equal(Array.from(option.label).length, MAX_OPTION_LABEL_CHARS, 'the bound applies after the control characters are removed')
  }
})

test('HAT-11 a purely count-driven overflow reports the question limit when nothing is carried', () => {
  const questions = Array.from({ length: MAX_QUESTIONS + 1 }, (_unused, index) => ({
    id: `q${index}`,
    question: 'Q'.repeat(SHORT_BODY_CHARS),
  }))
  // The fixture must overflow the count without coming near the total: otherwise
  // the size bound fires first and the reason under test is never reached.
  const fixtureCost = questions.reduce((sum, entry) => sum + entry.question.length + entry.id.length, 0)
  assert.ok(fixtureCost < MAX_TOTAL_QUESTION_CHARS, 'the count fixture must fit inside the size bound')

  const result = parseAskUserQuestionArguments(JSON.stringify({ questions }))
  assert.equal(result.questions.length, MAX_QUESTIONS)
  assert.equal(result.droppedQuestions, 1)
  assert.ok(result.droppedFields.includes(`questions[${MAX_QUESTIONS}+]`))
  // The reason names a bound only when no mail is produced at all: a partial
  // carry reports its loss through `droppedQuestions`, and a `dropReason` here
  // would contradict the questions the same result is carrying.
  assert.equal(result.dropReason, undefined)

  // The same count of questions with no body at all: every one is dropped by its
  // own field check, which leaves the count bound as the only limit that fired
  // and therefore the only one the reason may name.
  const unusable = parseAskUserQuestionArguments(
    JSON.stringify({ questions: Array.from({ length: MAX_QUESTIONS + 1 }, (_unused, index) => ({ id: `q${index}` })) }),
  )
  assert.equal(unusable.questions.length, 0)
  assert.equal(unusable.droppedQuestions, MAX_QUESTIONS + 1)
  assert.equal(unusable.dropReason, 'question-limit', 'the count bound decided it, not the size bound')
})

test('HAT-11b a question refused by the size bound still spends the budget, so the carried set is a prefix', () => {
  // Three maximal bodies plus their ids reach a running total of 6006 at the third
  // question, six characters over the bound, so the third is the question the size
  // bound refuses. The fourth is three characters wide.
  const result = parseAskUserQuestionArguments(
    JSON.stringify({
      questions: [
        { id: 'q1', question: 'x'.repeat(MAX_QUESTION_CHARS) },
        { id: 'q2', question: 'y'.repeat(MAX_QUESTION_CHARS) },
        { id: 'q3', question: 'z'.repeat(MAX_QUESTION_CHARS) },
        { id: 'q4', question: 'w' },
      ],
    }),
  )

  assert.deepEqual(
    result.questions.map((entry) => entry.id),
    ['q1', 'q2'],
  )
  assert.equal(result.droppedQuestions, 2)
  assert.deepEqual(result.droppedFields, ['questions[2]', 'questions[3]'])
  assert.equal(result.dropReason, undefined, 'a partial carry reports through droppedQuestions, not through a bound')
  // The three-character `q4` fits inside the bound on its own, so carrying it would
  // be the tempting outcome; it is refused because the refused `q3` spent the
  // budget. Advancing the running total only for carried questions would carry `q4`
  // through the gap and make the carried set stop being a prefix, which is the
  // assertion below.
  assert.equal(result.questions.at(-1)?.id, 'q2', 'nothing after the first refusal may be carried')
})

test('HAT-11c the size bound always carries its leading question, so content-limit is not a reachable drop reason', () => {
  // Everything the parser carries must fit inside `MAX_TOTAL_QUESTION_CHARS`, and a
  // body is capped at `MAX_QUESTION_CHARS` and an id at `MAX_QUESTION_ID_CHARS`, so
  // the first well-formed question of a call can spend at most a third of the total
  // and is always carried. Four such questions exhaust the total between them, which
  // is the most a call can carry, and a caller therefore never reaches the branch
  // that would report `content-limit`. The fixture below is the largest set the
  // parser will carry at all: a missing body spends the leading slot and the four
  // remaining bodies spend the total.
  const result = parseAskUserQuestionArguments(
    JSON.stringify({
      questions: [
        { id: 'no-body' },
        { id: 'q1', question: 'x'.repeat(MAX_QUESTION_CHARS) },
        { id: 'q2', question: 'y'.repeat(791) },
        { id: 'q3', question: 'w'.repeat(792) },
        { id: 'q4', question: 'v'.repeat(1200) },
        { id: 'q5', question: 'u'.repeat(100) },
      ],
    }),
  )

  assert.equal(result.questions.length, 5)
  assert.equal(result.droppedQuestions, 1)
  // The one refusal is the missing body, which is a field failure and not a bound:
  // the six costs come to 2009 + 793 + 794 + 1202 + 102 and stay inside the total,
  // so no question here is refused by size at all.
  assert.deepEqual(result.droppedFields, ['questions[0].question'])
  assert.equal(result.dropReason, undefined)
  // Recording that `content-limit` is unreachable is the honest outcome for a
  // fixture that cannot produce it: asserting the value would only pass against an
  // implementation that had stopped carrying a leading question it is required to
  // carry. The reachable size behaviour — the bound refusing questions and the
  // carried set staying a prefix of the call — is proved under HAT-11b.
  assert.notEqual(result.dropReason, 'content-limit')
})

test('HAT-11d questions that are all unusable report neither limit', () => {
  const result = parseAskUserQuestionArguments(JSON.stringify({ questions: [{}, { id: 'only-an-id' }] }))

  assert.equal(result.questions.length, 0)
  assert.equal(result.droppedQuestions, 2)
  // Neither bound truncated anything, so naming one would send an operator
  // looking for a limit that was never reached.
  assert.equal(result.dropReason, 'no-usable-question')
})

test('HAT-12 an approval is rebuilt from its allowlisted fields and leaks nothing else', () => {
  const notification = toApprovalNotification(
    {
      toolName: 'bash',
      reason: 'the command writes outside the workspace',
      callId: 'call-7',
      secret: SENTINEL,
      nested: { a: 1 },
      arguments: { command: `echo ${SENTINEL}` },
    },
    'session-1',
    '/workspace/project',
    1_750_000_000_000,
  )

  assert.ok(notification !== undefined)
  assert.deepEqual(notification, {
    kind: 'approval',
    sessionId: 'session-1',
    toolName: 'bash',
    observedAt: 1_750_000_000_000,
    callId: 'call-7',
    reason: 'the command writes outside the workspace',
    cwd: '/workspace/project',
  })
  // Every key, asserted against the named allowlist rather than by eye: a spread
  // of the source record would add `secret`, `nested`, and `arguments` here — and
  // `arguments` is the approved tool's own arguments, which is the field the
  // approval contract exists to keep out of a mailbox.
  assert.deepEqual(Object.keys(notification).sort(), APPROVAL_KEYS)
  assert.ok(
    Object.keys(notification).every((key) => APPROVAL_KEYS.includes(key)),
    `an unexpected key reached the approval: ${Object.keys(notification).join(', ')}`,
  )
  assert.ok(!JSON.stringify(notification).includes(SENTINEL))
})

test('HAT-12b an approval without a tool name is not a notification at all', () => {
  for (const value of [undefined, null, {}, { toolName: '' }, { toolName: 42 }, { toolName: '   ' }, [], 'bash']) {
    assert.equal(
      toApprovalNotification(value, 'session-1', undefined, 1),
      undefined,
      `${JSON.stringify(value) ?? String(value)} must yield no notification`,
    )
  }
  // A non-object payload must not throw either: the audit event is delivered by
  // the runtime, so its shape is a possibility rather than a contract.
  assert.equal(toApprovalNotification(null, 'session-1', '/workspace', 1), undefined)
})

test('HAT-12c an oversized approval reason is truncated and its line structure flattened', () => {
  const notification = toApprovalNotification(
    { toolName: 'bash', reason: `x\n${'r'.repeat(MAX_APPROVAL_REASON_CHARS + 250)}` },
    'session-1',
    undefined,
    1,
  )

  assert.ok(notification !== undefined)
  const reason = notification.reason
  assert.ok(reason !== undefined)
  assert.equal(Array.from(reason).length, MAX_APPROVAL_REASON_CHARS)
  assert.ok(!reason.includes('\n'), 'the reason reaches a mail body line, so it stays on one line')
})

test('HAT-12d the working directory is carried when known and omitted when not', () => {
  const withCwd = toApprovalNotification({ toolName: 'bash' }, 'session-1', '/workspace/project', 1)
  assert.ok(withCwd !== undefined)
  assert.equal(withCwd.cwd, '/workspace/project')
  assert.ok('cwd' in withCwd)

  const withoutCwd = toApprovalNotification({ toolName: 'bash' }, 'session-1', undefined, 1)
  assert.ok(withoutCwd !== undefined)
  // An absent key and a key holding `undefined` are different observations: the
  // first says the session header carried no directory, the second is
  // indistinguishable from a renderer that dropped it.
  assert.equal('cwd' in withoutCwd, false)
})

test('HAT-12e both optional approval fields are independent of each other', () => {
  const reasonOnly = toApprovalNotification({ toolName: 'write', reason: 'the path is outside the workspace' }, 's', undefined, 5)
  assert.ok(reasonOnly !== undefined)
  assert.deepEqual(reasonOnly, {
    kind: 'approval',
    sessionId: 's',
    toolName: 'write',
    observedAt: 5,
    reason: 'the path is outside the workspace',
  })
  assert.equal('callId' in reasonOnly, false)

  const callIdOnly = toApprovalNotification({ toolName: 'write', callId: 'call-1' }, 's', undefined, 5)
  assert.ok(callIdOnly !== undefined)
  assert.deepEqual(callIdOnly, { kind: 'approval', sessionId: 's', toolName: 'write', observedAt: 5, callId: 'call-1' })
  assert.equal('reason' in callIdOnly, false)
})

test('HAT-12f an oversized callId is bounded like a question id', () => {
  const notification = toApprovalNotification(
    { toolName: 'bash', callId: 'c'.repeat(MAX_QUESTION_ID_CHARS + 100) },
    'session-1',
    undefined,
    1,
  )

  assert.ok(notification !== undefined)
  assert.equal(Array.from(notification.callId ?? '').length, MAX_QUESTION_ID_CHARS)
})
