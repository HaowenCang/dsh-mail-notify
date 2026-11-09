# dsh-mail-notify v0.5.5

Settings-page release. npm publication is performed separately by the maintainer
using interactive 2FA.

- **The settings moved into the DSH Settings window.** Open Settings (Ctrl+, in the
  desktop app, Ctrl+Alt+, in the browser) and choose **Email alerts** (邮件通知).
  The plugin's own page under Plugins → Installed now only points there.
- **Clearer page.** Rewritten English and Simplified Chinese copy; a status
  headline (Off, Setup needed, Running, Not running, configuration error); numbered
  setup steps while setup is incomplete; required fields marked `*`, with a save the
  Host would refuse stopped on the page with the reason shown; **Restore default**
  per field; rarely used fields in a collapsed Advanced section; a sticky
  Discard/Save bar.
- **SMTP setup help.**
  - Quick fill for QQ, 163, 126, Tencent Exmail and Gmail. It fills the server,
    port and encryption, and fills an empty sender with the username.
  - A QQ/Foxmail, 163, 126 or Gmail username fills an empty server in
    automatically. A server you already filled in is never overwritten; the page
    offers a one-click switch instead.
  - Step-by-step instructions under the password field for getting the
    provider's authorization code or app password, with a link to the provider.
  - A warning when port and encryption do not match.
- **No Host change.** Only the browser half changed; the declared DSH range
  `>=0.2.1-rc.3 <0.2.2`, the Config schema, and the notification runtime are those
  of `0.5.4`. Saved configuration carries over unchanged.

Validation: `npm run verify` (626 tests, 0 failures), `pack:check` and
`scan:secrets` on the packed archive, and the archive installed into an isolated
DSH `0.2.2-rc.1` web profile with the Settings entry, the page, provider auto-fill
and the authorization-code guide checked in a real browser. Not re-run: the
end-to-end probes and real SMTP delivery.
