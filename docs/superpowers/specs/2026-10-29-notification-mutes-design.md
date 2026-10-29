# Notification mutes for v0.5.3

The user approved direct implementation using two lists in the existing plugin
configuration card: `mutedWorkspaces` (workspace paths) and `mutedSessions`
(complete session IDs). Both default to empty and persist through the existing
volatile Config/profile mechanism. Either match suppresses every automatic
notification family: completion, token limit, terminal failure, question, approval.
Explicit Test Email remains available because it has no session/workspace scope.

## Approach

Use the existing settings card and persistence path rather than introduce new
host page integrations. A contextual toggle was offered; the user selected the
configuration lists and instructed direct implementation. Add no dependencies
and retain the DSH compatibility range.

## Matching and lifecycle

Match exact workspace directories from session `header.cwd`, with lexical path
normalization, trailing separator removal, and case-insensitive Windows paths
(including UNC). POSIX paths remain case-sensitive. Do not resolve symlinks,
read directories, expand environment variables, or match directory prefixes.
Session IDs match exactly, case-sensitively, after trimming configuration entries.
Blank entries are ignored. Unknown workspace data cannot match a workspace rule.
Use a newline-separated list editor so commas and semicolons remain legal path
characters. Removing an entry restores normal notification eligibility.

Keep existing reconfiguration semantics: accepted configuration changes replace
the runtime and discard waiting jobs. Already started sends may finish. Muted
candidates do not enqueue or consume dedupe keys. Log the suppression reason
without logging the workspace path or list contents.

## Verification

Test all notification families, other workspaces and sessions, Windows/POSIX/UNC
normalization, missing metadata, schema defaults and rejection of malformed lists,
Web save/reset/locale parity, and live reconfiguration. Run `npm run verify`,
pack the v0.5.3 archive and inspect it. Do not publish or change existing archives.
