# The probe: what each scenario composes and what it asserts.
#
# `scripts/probe-e2e.mjs` boots the shipped `headless` profile against a
# disposable `DSH_HOME`, a loopback SMTP server on an OS-chosen port, and one
# overlay (`overlay-base.yml`) that adds only what the product tree does not
# carry for the test. Every run starts from an empty probe home: the profile,
# the session store, and the credential document are all recreated, so an
# earlier run's notification cannot be read as this run's evidence.
#
# What is real in every scenario: the agent loop, the tool registry, the session
# log, `ctx.userQuestions`, `ctx.approval`, the shipped credential store, the
# plugin's listeners, its queue, its mailer, and the SMTP conversation.
#
# What is scripted, and named in the output: the model's tokens
# (`scripted-provider.mjs`), the human (`auto-answer.mjs`), and the SMTP peer's
# identity (loopback, no TLS, no authentication, nothing forwarded).
#
# Scenarios
#
#   questions             notifyQuestions + notifyCompleted
#     One `ask_user_question` call, then a final answer. Asserts exactly two
#     messages — "[DSH] Input required — Choose Mode" and "[DSH] Task
#     completed" — which is what proves the question's dedupe namespace did not
#     consume the turn's.
#
#   errors                notifyErrors + notifyCompleted
#     One terminal provider failure. Asserts exactly one "[DSH] Task failed — …"
#     message and none for a failure DSH retried and recovered from.
#
#   approvals             notifyApprovals + notifyCompleted, answer `allowed-once`
#     The scripted model calls `probe_request_approval`, whose body calls the
#     real `ctx.approval.request()` from inside the open Turn. The answerer
#     withholds its answer until the probe has seen the approval mail arrive
#     over SMTP, so the timeline it prints proves the notification happened
#     while the approval was still pending rather than after the fact.
#     Asserts exactly two messages — the approval and the completion — and that
#     the approval's tool arguments are absent from the raw SMTP payloads and
#     from the captured logs.
#
#   approvals-duplicate   as above, plus a real duplicate audit record
#     After the decision the tool appends a second `approval/asked` with the
#     same service-issued id through the real `Session.append()`. The probe
#     reports how many times each id was published, so a replay that never
#     happened cannot be mistaken for a dedupe that worked. Asserts exactly two
#     messages.
#
#   approvals-rejected    as above, answer `rejected`
#     Asserts one approval mail, an `approval/decided` with outcome `rejected`,
#     a tool result marked as an error, and no second "approval required" mail
#     at the decision. The Turn's later settlement is recorded as observed.
#
#   credentials           the credential-reference contract
#     `credential-contract.mjs` checks the installed `credentialRef()` /
#     `isCredentialRefName()` grammar, the `CredentialRef` vs `CredentialKey`
#     split, the document parser's `refs` section, and the live service's
#     `resolve()`/`describe()` over the disposable document. It prints presence,
#     layer, and length — never a value.
#
# Not present here: `scenarios/*.yml`. The switch set for each scenario is built
# in `probe-e2e.mjs` and travels to the plugin as one JSON document, so "the
# settings that took effect" and "the settings the probe printed" are the same
# fact rather than two that could disagree.
#
#   timed-questions       the two DSH 0.2 question modes under one tool name
#     An expiring wait (`timeout: 3`), a late answer to it, and a wait that can
#     never expire (`timeout: 2147483`). Asserts two question mails and one
#     completion, that the late reply is in no body and heads no user-prompt
#     section, and that neither the timed wait value nor a raw `pending` payload
#     reaches a mail. The unmistakable timeout value is what makes the negative
#     scan non-vacuous: a leak would be readable, not merely present.
#
# Isolation, and why it is on the command line
#
# Every probe above writes only inside its own disposable tree and boots a
# profile from a shipped template. That is safe by default, but a default is not
# evidence: an operator who must show that no profile of theirs was touched needs
# the two facts that decide it to appear in the command's own output. Both are
# therefore overridable, and the probes print the paths they use.
#
#   DSH_MAIL_NOTIFY_PROBE_ROOT     the disposable tree (DSH_HOME lives under it)
#   DSH_MAIL_NOTIFY_PROBE_PROFILE  the profile name
#
# A non-shipped profile name has no bundle list of its own, so the probe creates
# it from the `headless` template with the launcher's own
# `--from-default-profile`. That is what lets an operator who reserves the
# shipped names (`web`, `headless`, `default`) still run the full matrix. The
# launcher refuses a target directory that already exists, so a probe must not
# create the profile directory itself.
#
# The browser half
#
# `browser-e2e.mjs` is the one probe that does not boot anything: the caller owns
# the instance. Boot a disposable web profile on a port that is not the
# operator's, install the packed archive, and hand the probe the URL the
# launcher printed — the one carrying the instance token.
#
#   PROBE_WEB_URL=<url with token> PROBE_SMTP_PORT=25101 \
#   PROBE_CHROME_DATA=<dir> PROBE_OUT=<dir> \
#   node scripts/probe/browser-e2e.mjs
#
# It drives real Chrome over the DevTools Protocol (through Node's own
# `WebSocket`, so it adds no dependency) and asserts what the page rendered. Two
# constraints are built in, both learned from a retracted conclusion and a
# misread status code in the v0.4.0 work: the field assertion compares a *key
# set* rather than a control count, and a commit is judged by the RPC envelope's
# `ok` field rather than by the HTTP status, because the write path answers 200
# on refusal too.
