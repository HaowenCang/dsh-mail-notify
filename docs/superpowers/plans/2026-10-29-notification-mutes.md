# Notification Mutes Implementation Plan

> Execute inline using superpowers:executing-plans and test-driven-development.

**Goal:** Add workspace and session mail exclusions in v0.5.3.
**Architecture:** Two volatile array fields, one shared scope policy, existing
configuration card and notification pipeline.
**Tech Stack:** TypeScript, Schemastery, React, Node test runner.
**Spec:** `../specs/2026-10-29-notification-mutes-design.md`.

## Constraints and review focus

Retain dependencies and host range. Preserve all previous artifacts. Windows
path spelling, POSIX case, path-prefix collisions, absent metadata, and muted
error/question/approval notifications must have direct coverage. Use the current
checkout on a new feature branch so the user's shared workspace shows the work.
No external publication is requested. No subagents are needed for this change.

## Tasks

- [x] Write failing policy, pipeline, schema, and Web list tests; run them.
- [x] Add `src/notification-scope.ts`, Config/types/snapshot fields, and gates in
  `notifier.ts` and human-attention policy; supply session scope from handlers.
- [x] Add multiline list fields and bilingual copy to the existing card; update
  field-count guards from 23 to 25 and verify save/reset behavior.
- [x] Update package/lock version and current README; add release notes.
- [x] Run full verification, review the diff, pack and scan the v0.5.3 artifact.

## Execution record

Baseline `npm run verify`: 581 passed, 0 failed, 0 skipped. User approved the
recommended setting lists and direct implementation. Work runs inline on
`codex/notification-mutes-v0.5.3`.

Completed inline; final verify 603 passed, 0 failed/skipped. Independent review
found two POSIX path collisions; both received red/green regressions and fixes.
Ruling: only configuration entries are trimmed; live cwd keeps its literal
characters, because POSIX whitespace and backslashes can identify directories.
Browser QA uses actual card/controller with simulated services and is explicitly
separate from full DSH deployment evidence. The branch remains local and
uncommitted for the user's review; no integration/publication was requested.
See `V0.5.3_VALIDATION.md` for archive identity and verification limits.
