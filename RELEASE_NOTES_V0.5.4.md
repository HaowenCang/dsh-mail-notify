# dsh-mail-notify v0.5.4

Host-compatibility release. GitHub release archive; npm publication is performed
separately by the maintainer using interactive 2FA. See
`release/v0.5.4/NPM_PUBLISH.md`.

- **DSH range is now `>=0.2.1-rc.3 <0.2.2`** (`engines.dsh` and the two
  shared-instance peers `@deepseek-ai/dsh-credentials` and
  `@deepseek-ai/dsh-session`). Previously `>=0.2.1-rc.2 <0.2.2-0`.
- **DSH `0.2.2-rc.1` is now admitted.** `0.5.3` is refused there by the DSH
  install gate (`requirements {"engines.dsh":">=0.2.1-rc.2 <0.2.2-0"}`).
- **Later `0.2.2` prereleases no longer disable the plugin.** DSH evaluates
  `engines.dsh` with `includePrerelease`, so the plain `<0.2.2` upper bound
  admits every `0.2.2-alpha.*` / `0.2.2-rc.*` and rejects only `0.2.2` final.
  Admitted-but-unmeasured hosts are not claimed as tested.
- **Minimum supported host raised to `0.2.1-rc.3`.** `0.2.1-rc.2` is no longer
  admitted; stay on `0.5.3` for that host.
- Development baseline moved to the `0.2.2-rc.1` packages, `@deepseek-ai/cordis`
  `4.1.0` and `@deepseek-ai/schemastery` `3.19.0`. Peer ranges for Cordis
  (`^4.0.4`) and Schemastery (`^3.18.4`) are unchanged.
- No source change: `src/**` is identical to `0.5.3`, and the compiled `lib/**`
  in the archive is byte-identical to the `0.5.3` archive's. Feature behavior,
  including workspace/session mutes, is that of `0.5.3`.

Measured hosts and limits: [`V0.5.4_COMPAT_VALIDATION.md`](V0.5.4_COMPAT_VALIDATION.md).
