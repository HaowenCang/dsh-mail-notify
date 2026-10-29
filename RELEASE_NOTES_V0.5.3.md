# dsh-mail-notify v0.5.3

GitHub release archive; npm publication is performed separately by the
maintainer using interactive 2FA. See `release/v0.5.3/NPM_PUBLISH.md`.

- Add **Muted workspaces** / **免通知工作区**: one absolute workspace path per
  line suppresses automatic mail for every session whose recorded workspace
  directory matches.
- Add **Muted sessions** / **免通知会话**: one full, case-sensitive session ID
  per line suppresses automatic mail for that session.
- Both lists apply to completions, token-limit endings, terminal failures,
  questions and approvals. Other scopes retain their normal policy. Empty lists
  preserve previous behavior. Explicit Test Email remains available.
- Windows paths normalize separators and case; POSIX paths preserve case.
  Directory matches are exact, without prefix/glob matching or filesystem access.
- Settings persist in the existing DSH profile and take effect on Save. Existing
  configuration-update behavior replaces the runtime and discards queued jobs;
  an already started send may complete. Enter `[]` to explicitly clear a list;
  blank/reset restores inherited configuration.
- Keep the DSH range `>=0.2.1-rc.2 <0.2.2-0` and all dependency versions unchanged.

The v0.5.2 host compatibility results are historical evidence; this candidate's
validation is recorded separately in `V0.5.3_VALIDATION.md`.
