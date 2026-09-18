# Probe scenario overlays are deliberately empty of configuration.
#
# The base overlay already carries the plugin's full settings as one JSON
# document built by `scripts/probe-e2e.mjs` from the scenario's switch set, so
# these files exist only to document what each scenario asserts. Keeping the
# switches in the probe rather than split across YAML files is what makes
# "the settings that took effect" and "the settings the probe printed" the same
# fact rather than two that could disagree.
#
# scenarios/questions.yml — notifyQuestions on, notifyCompleted on.
#   Expected: exactly two messages, "[DSH] Input required — Choose Mode" and
#   "[DSH] Task completed", which together prove the question's dedupe namespace
#   does not consume the turn's.
#
# scenarios/errors.yml — notifyErrors on, notifyCompleted on.
#   Expected: exactly one "[DSH] Task failed — …" message for a terminal
#   provider failure, and none for a failure DSH retried and recovered from.
#
# scenarios/approvals.yml — notifyApprovals on, notifyCompleted on.
#   Expected: one "[DSH] Approval required — <tool>" message per `approval/asked`.
