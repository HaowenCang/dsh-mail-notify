# v0.5.3 GitHub release and npm handoff

Date: 2026-10-29. Status: **GitHub released; awaiting maintainer's local npm 2FA publication**.

## Source and GitHub publication

- PR: https://github.com/HaowenCang/dsh-mail-notify/pull/3 (merged).
- Feature commit: `25539a7338e4145992635ecb2a9bea608d919bd5`.
- Feature branch head: `2c9daa25de25b2985b1e929403509e7bfa920500`.
- Release source / merge commit: `179b4e14616346fab743be245145fb78726b630b`.
- Base before merge: `e567de3fbe1558bb7622c7d2b2b44bbf4c5e1a49`.
- Merge required the expected feature head SHA; the merged tree equals the
  verified feature tree. No force push or branch deletion was used.
- Annotated tag `v0.5.3`: `bd152307f0800e8bfe611916ecd392a3ff5a3b47`, peeled
  target `179b4e14616346fab743be245145fb78726b630b`.
- Release: https://github.com/HaowenCang/dsh-mail-notify/releases/tag/v0.5.3.
- Release ID: `427881233`; published `2026-10-29T13:10:08Z`.
- Draft: false. Prerelease: false. `/releases/latest` returned `v0.5.3`.
- Release body matches `RELEASE_BODY_V0.5.3.md` after newline normalization.

The GitHub connector created and merged the PR; it has no Release attachment
interface in this session, so `gh release create --verify-tag --latest` created
the Release and uploaded its four assets together.

## Verification

- Release-time `npm run verify`: 603 passed, 0 failed, 0 skipped; typechecks,
  host/client build and text-integrity check passed.
- Final archive package tests: 11 passed, 0 failed.
- Archive inspection: 117 entries, 27 compiled modules; no forbidden entry.
- Static archive scan: 0 secret-shaped-literal hits, isolated empty credential
  profile; operator credentials were not read.
- The final archive differs from the retained implementation candidate only in
  `README.md`. All 113 archived `lib/**` files match the checked build bytes.
- Archived README/package metadata match the tagged source after CRLF/LF
  normalization; raw text bytes differ because of the Windows checkout line
  endings. Release helper/manifest/checksums have explicit LF attributes.
- Real-browser UI evidence is from the implementation phase's actual card and
  controller with simulated Host services; no new full DSH deployment or real
  SMTP delivery measurement is claimed.

## Asset read-back

All four GitHub assets were downloaded into the separate ignored directory
`tmp/v053-release/github-download/`. Downloaded files are byte-identical to their
local release files; each SHA-256 also equals GitHub's asset digest. Every entry
in the downloaded `SHA256SUMS.txt` passed. The downloaded publish helper ran
successfully with `-ValidateOnly`; no npm publication command was executed.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `dsh-mail-notify-0.5.3.tgz` | 209019 | `06c6b24587ed76c8c35217d44f812705db940dfe74865d96d325768166577bad` |
| `publish-npm.ps1` | 2179 | `4f6b26e43f4119769ba07566d3a612f04f500ce457d142bccb5c5881da9fc78f` |
| `release-manifest.json` | 760 | `bebf7a2a44c73f7b86f91396ae2d9be73df76ceb28e0f2f606b2cd3c7844faf1` |
| `SHA256SUMS.txt` | 262 | `35369a46176fe40c2d1cf3ea2960075d9e2bbce4f5e22547eb0ba354ce8c57e5` |

Npm integrity for the exact archive:

```text
sha512-wXQnJsJ0EAcRK7x0mfouZRg/kOWVAawTl/2pzMZoJj5IQFmD1YQkL6kNawVR+cfHF1Qh5l7c4/4NBVip9+WTyQ==
```

The original v0.5.2 archive remains at its recorded SHA-256
`0a21e750fe32b47c0bdcb1f8c9500a6a3597373092bd4e6e376c2d76f08fff76`.
The v0.5.2 annotated tag remains `d7b4c70711052090c7c2dc8743861ce824da875c`,
peeled target `dab495da9f59e9a77f5153b060e0ae1db8008b44`.

## npm handoff

Read-only registry check at `2026-10-29T13:11:41.472Z`: `latest` is `0.5.2` and
`0.5.3` is absent. `npm whoami` matches the package's maintainer. No npm publish,
dist-tag write, token replacement, or 2FA bypass was performed.

The maintainer runs locally, following npm's interactive 2FA prompt:

```powershell
npm publish 'E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.3.tgz' --access public --tag latest --registry=https://registry.npmjs.org/ --ignore-scripts
```

Optional preflight: `& '.\release\v0.5.3\publish-npm.ps1' -ValidateOnly`.
The helper without `-ValidateOnly` checks the archive and then invokes npm
locally. Full instructions: [`NPM_PUBLISH.md`](release/v0.5.3/NPM_PUBLISH.md).
After the user's publication, verify the registry's version, integrity and
`latest` tag before reporting npm success. Do not repack this archive.

This report and `release/v0.5.3/github-readback.json` are a post-release
documentation commit. They are not part of the tagged release source, and do
not move the tag or change any published asset.
