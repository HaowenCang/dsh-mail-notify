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
