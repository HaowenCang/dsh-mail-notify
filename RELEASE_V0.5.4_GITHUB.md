# v0.5.4 GitHub release and npm publication

Date: 2026-11-06. Status: **GitHub released; published on npm by the maintainer**.

## Source and GitHub publication

- PR: https://github.com/HaowenCang/dsh-mail-notify/pull/4 (merged).
- Compat commit: `64b0f38` (range `>=0.2.1-rc.3 <0.2.2`, version `0.5.4`).
- Feature branch head: `3084ce8d34104060f892e5373d2c2e812cafdbc1` (release body
  updated for the npm publication).
- Release source / merge commit: `123bedf52b81cb43ff2eed928659050be4470a21`.
- Base before merge: `d46beeae5efce137cc8b96667803566bc6a5dfdd`.
- Merge required the expected feature head SHA; the merged tree
  (`5f98bb93755d9b8f1a153e91454296cdef3fec23`) equals the feature head tree.
  No force push or branch deletion was used.
- Annotated tag `v0.5.4`: `72046e33d3c1359067ce237c2d4d21cc6c3bbd4d`, peeled
  target `123bedf52b81cb43ff2eed928659050be4470a21`.
- Release: https://github.com/HaowenCang/dsh-mail-notify/releases/tag/v0.5.4.
- Release ID: `436474648`; published `2026-11-06T12:27:26Z`.
- Draft: false. Prerelease: false. `/releases/latest` returned `v0.5.4`.
- Release body matches `RELEASE_BODY_V0.5.4.md` after newline normalization.

`gh release create --verify-tag --latest` created the Release and uploaded its
four assets together.

## Verification

Measured before release; details in
[`V0.5.4_COMPAT_VALIDATION.md`](V0.5.4_COMPAT_VALIDATION.md).

- `npm run verify` against the `0.2.2-rc.1` packages: 603 passed, 0 failed,
  0 skipped.
- `pack:check` and `scan:secrets` passed: 117 entries, no forbidden entry,
  0 credential-value and 0 shaped-literal hits.
- Native `dsh plugin add` with no version exemption admitted the archive on DSH
  `0.2.1-rc.3` and `0.2.2-rc.1`. The released `0.5.3` is refused by
  `0.2.2-rc.1`.
- Eight end-to-end probes passed on each host, with a credential contract of
  14 PASS / 0 FAIL on each.
- Compiled `lib/**` is byte-identical to the `0.5.3` archive's; `src/**` is
  unchanged.
- Not covered: real-browser Web UI on a live `0.2.2-rc.1` host, real SMTP
  delivery, and admitted hosts other than the two measured.

The commit `3084ce8` changed only `RELEASE_BODY_V0.5.4.md`, which is not in
the archive. The archive was not repacked after validation.

## Asset read-back

All four GitHub assets were downloaded into the separate ignored directory
`tmp/v054-release/github-download/`. Downloaded files are byte-identical to their
local release files; each SHA-256 also equals GitHub's asset digest. Every entry
in the downloaded `SHA256SUMS.txt` passed. The downloaded publish helper ran
successfully with `-ValidateOnly`; it executed no npm publication command.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `dsh-mail-notify-0.5.4.tgz` | 208942 | `8fa596c32613a23321ed18cf8f78175234bcea2009d90f21e6512b38a6bf7eac` |
| `publish-npm.ps1` | 2179 | `5f1e1e6aa5114581c1445cb33961f42eefc4db818d44d18572e528420240612b` |
| `release-manifest.json` | 842 | `e6dd254b662873a0acd29488d267abb492def5cc420ad0f22d46027858958d32` |
| `SHA256SUMS.txt` | 262 | `ea5014212ae9d173194b9d58b36286e9b959f22b3521fb1ea9ef78bf09cacfdb` |

The `v0.5.3` annotated tag remains `bd152307f0800e8bfe611916ecd392a3ff5a3b47`,
peeled target `179b4e14616346fab743be245145fb78726b630b`.

## npm publication

The maintainer published `dsh-mail-notify@0.5.4` locally with interactive 2FA
before the GitHub release. Read-only registry check at
`2026-11-06T12:27:56.429Z`:

- `latest` is `0.5.4`.
- `dist.integrity` is
  `sha512-A9tuZjLEGJBfA/z63k/GCuO+6KtgFybF1yehGp4uNb2YdZZNezZwwJ6fPWQMMeWct2XbOA26yPAHSYkPKGkkZA==`,
  equal to the release archive's.
- `dist.shasum` is `5e3d5200559f4121277badd0e2c2a285c1c9e6f7`, equal to the
  SHA-1 of the release archive.
- `engines.dsh`, `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-session`
  are `>=0.2.1-rc.3 <0.2.2`.

No npm publish, dist-tag write or token change was performed in this session.

This report and `release/v0.5.4/github-readback.json` are a post-release
documentation commit. They are not part of the tagged release source, and do
not move the tag or change any published asset.
