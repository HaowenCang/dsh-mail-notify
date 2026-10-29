# dsh-mail-notify v0.5.3

Adds workspace and session exclusions to the existing bilingual mail settings
card. Configure **Muted workspaces / 免通知工作区** with one absolute workspace
path per line, or **Muted sessions / 免通知会话** with one full session ID per line.
Either match suppresses completion, token-limit, terminal failure, question and
approval emails. Empty lists retain the existing behavior. Explicit Test Email
remains available.

Workspace matching is by exact recorded directory, with Windows/UNC slash and
case normalization; POSIX paths preserve case. Session IDs are case-sensitive.
Save persists through the existing profile configuration. Enter `[]` to clear
a list explicitly; blank/Reset restores inheritance. Saved configuration changes
replace the runtime and discard waiting jobs; an already started send may finish.

Validation: **603 tests passed, 0 failed, 0 skipped**, typechecks and build passed,
archive inspection and static secret-shaped-literal scan passed. Browser QA used
the production card/controller with simulated Host services at desktop and mobile
sizes; no fresh full DSH deployment or real SMTP delivery claim is made. The host
range remains `>=0.2.1-rc.2 <0.2.2-0`; prior host measurements remain historical.

**npm publication is pending the maintainer's local interactive 2FA step.**
Download the attached archive for installation until the registry is verified.
The attached `publish-npm.ps1`, `release-manifest.json`, and `SHA256SUMS.txt`
support publishing exactly the same archive locally.

- [Release notes](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.3/RELEASE_NOTES_V0.5.3.md)
- [Validation and limits](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.3/V0.5.3_VALIDATION.md)
- [Local npm publication instructions](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.3/release/v0.5.3/NPM_PUBLISH.md)

Install the downloaded archive:

```powershell
dsh plugin --profile web add ./dsh-mail-notify-0.5.3.tgz
```
