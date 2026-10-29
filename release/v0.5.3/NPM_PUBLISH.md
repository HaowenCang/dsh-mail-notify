# Publish dsh-mail-notify 0.5.3 locally

The GitHub archive and npm publication are separate steps. The maintainer must
perform the npm write locally and complete npm's interactive 2FA flow. No OTP
or token needs to be sent to this chat.

From this checkout, verify the exact prepared archive without publishing:

```powershell
Set-Location 'E:\Projects\DSHarness\dsh-mail-notify'
& '.\release\v0.5.3\publish-npm.ps1' -ValidateOnly
```

Then publish the same archive in your interactive terminal:

```powershell
npm publish 'E:\Projects\DSHarness\dsh-mail-notify\dsh-mail-notify-0.5.3.tgz' --access public --tag latest --registry=https://registry.npmjs.org/ --ignore-scripts
```

Alternatively, run `& '.\release\v0.5.3\publish-npm.ps1'` to repeat the hash and
identity checks immediately before invoking that publication. If downloading
the assets from GitHub, place the archive, `release-manifest.json`,
`SHA256SUMS.txt` and `publish-npm.ps1` together; the script supports that layout.
Use the existing npm account with package publication permission. If npm asks
you to log in, run `npm login --registry=https://registry.npmjs.org/` locally,
then retry publication and follow npm's 2FA instructions.

After publication, perform read-only verification:

```powershell
npm view dsh-mail-notify@0.5.3 version dist.integrity --json --registry=https://registry.npmjs.org/
npm view dsh-mail-notify dist-tags --json --registry=https://registry.npmjs.org/
```

The version must be `0.5.3`, `dist.integrity` must equal the manifest's
`archive.integrity`, and `latest` must be `0.5.3`. If publication succeeded but a
later verification is slow, recheck the registry before attempting publication
again. Do not rebuild or repack the archive for this handoff.
