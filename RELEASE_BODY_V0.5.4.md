# dsh-mail-notify v0.5.4

Host-compatibility release for **DSH `0.2.2-rc.1`**. `0.5.3` is refused by that
host's install gate; `0.5.4` installs and runs on it.

- DSH range is now **`>=0.2.1-rc.3 <0.2.2`**. DSH evaluates it with prereleases
  included, so later `0.2.2` prereleases do not disable the plugin; `0.2.2`
  final is not admitted.
- Minimum supported host is now `0.2.1-rc.3`. Stay on `0.5.3` for `0.2.1-rc.2`.
- No source change. Compiled `lib/**` is byte-identical to `0.5.3`, so features
  (including workspace/session mutes) are unchanged.

Validation: **603 tests passed, 0 failed, 0 skipped** against the `0.2.2-rc.1`
packages. Native plugin-manager install with no version exemption and **8/8
end-to-end probes passed on both `0.2.1-rc.3` and `0.2.2-rc.1`**. Not re-run:
real-browser Web UI and real SMTP delivery. Other admitted hosts are untested.

**npm publication is pending the maintainer's local interactive 2FA step.**
Download the attached archive for installation until the registry is verified.
The attached `publish-npm.ps1`, `release-manifest.json`, and `SHA256SUMS.txt`
support publishing exactly the same archive locally.

- [Release notes](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.4/RELEASE_NOTES_V0.5.4.md)
- [Compatibility validation and limits](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.4/V0.5.4_COMPAT_VALIDATION.md)
- [Local npm publication instructions](https://github.com/HaowenCang/dsh-mail-notify/blob/v0.5.4/release/v0.5.4/NPM_PUBLISH.md)

Install the downloaded archive:

```powershell
dsh plugin --profile web add ./dsh-mail-notify-0.5.4.tgz
```
