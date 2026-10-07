# Releases and the Update Channel

*How a desktop release reaches installed clients, how to rehearse that path before publishing, and how to pull a bad release back.*

This is the operator's reference. For what a *user* sees, read [Installation → Updates](../getting-started/installation.md#updates).

## How an installed client learns about a release

Two paths, depending on whether the app can install its own update.

| Platform | Path | Reads | Can self-install |
| --- | --- | --- | --- |
| Windows (NSIS) | electron-updater | `latest.yml` | Yes |
| Linux AppImage | electron-updater | `latest-linux.yml` | Yes |
| macOS | notice only | `version.json` | No — Gatekeeper blocks an unsigned self-update |
| Linux deb/rpm/pacman | notice only | `version.json` | No — the OS package manager owns the install |

Every one of those files is fetched through the same documented GitHub permalink:

```text
https://github.com/Kaysharp42/apiweave/releases/latest/download/<asset>
```

`/releases/latest` resolves to the newest release that is **not a draft and not a prerelease**. That single fact is what makes the kill switch below work.

Nothing reads `api.github.com` (60 requests/hour per IP, unauthenticated — a corporate NAT exhausts it) and nothing parses `releases.atom` or an HTML page. `build.publish` in `app/package.json` lists electron-builder's **generic** provider first for exactly this reason; see the header comment in `app/electron/updater.ts` for the full rationale.

## Cutting a release

Push a SemVer tag. `.github/workflows/desktop-release.yml` does the rest:

1. **validate** — checks the tag shape, that `app/package.json` and `app/package-lock.json` agree with it, and that the tag is on `main`. Checks that the `UPDATE_SIGNING_PRIVATE_KEY` secret exists and matches the public key the commit embeds ([Update signatures](#update-signatures)) — a missing secret or a commit still carrying the placeholder fails here, before anything is built. Creates the draft release, so the four build jobs can only ever *find* it rather than race to create it.
2. **build** (×4) — each job packages and publishes its own installers straight to the draft. Publishing is what makes electron-builder write `latest.yml` / `latest-linux.yml` and the differential blockmaps; `--publish never` produces none of them. The Windows job additionally uploads a `.zip` wrapping its installer — the download a person takes — while the bare `.exe` stays in the release because `latest.yml` names it and electron-updater cannot consume an archive.
3. **publish** — verifies the full asset set landed, verifies the manifests are internally true (below), signs them, writes `version.json`, checksums everything, then flips the release live.

### What CI actually guarantees

The **Verify update manifests** step asserts, for both `latest.yml` and `latest-linux.yml`:

- the `version` in the manifest equals the tag
- the file named in `path` exists in the release
- its base64 sha512 matches the bytes actually published

The **Sign update manifests** step then hashes each installer itself and appends an `apiweaveSignature` to its manifest — see [Update signatures](#update-signatures).

That is the check that a manifest is *true*, as distinct from merely *present*. It matters because those manifests became load-bearing when the generic provider went first: a manifest that disagrees with its own release breaks updates for every installed client, and a broken update channel cannot be fixed through the update channel.

`SHA256SUMS.txt` deliberately excludes `latest*.yml` — they are updater metadata rather than human downloads, they already carry their own sha512, and the rollout workflow rewrites them in place.

> **CI does not prove the updater works.** It proves the assets are coherent. Those are different claims, and only [Rehearsing the update path](#rehearsing-the-update-path-before-users-run-it) closes the gap.

## Update signatures

The builds are not OS code-signed, so on its own the sha512 in `latest.yml` only proves the download matches a manifest published in the same release. Anyone who can write a release asset — a compromised GitHub account or CI token — could otherwise ship code to every install.

So every update is also signed with an **Ed25519 key** that lives only in a GitHub Actions secret:

- `app/scripts/sign-update-manifest.mjs` (the **Sign update manifests** step) hashes the installer each manifest names and signs `version` + that sha512, appending `apiweaveSignature: <base64>` to `latest.yml` and `latest-linux.yml`.
- `app/electron/update_signing_key.ts` holds the public half, compiled into the app.
- `app/electron/update_signature.ts` checks the signature against the bytes actually downloaded, before the update can reach "downloaded". An update that fails is never installed — not by **Restart now**, not on quit (`UpdateManager` owns install-on-quit; electron-updater's own is off because it would run the download regardless) — and the Updates panel shows why. The log gets a `refusing update` line.

The signature binds the version, so an old signed installer relabelled as a newer version fails too. It does not cover `stagingPercentage`, so the rollout workflow still works without the key.

**A build carrying the placeholder key refuses every update**, with "This build has no update signing key" in the panel and log. The release workflow refuses to publish from such a commit, so this only affects local and dev builds.

### One-time setup

From `app/`:

```bash
node scripts/generate-update-signing-key.mjs | gh secret set UPDATE_SIGNING_PRIVATE_KEY --repo Kaysharp42/apiweave
git add electron/update_signing_key.ts
git commit -m "chore(release): embed the update signing key"
```

The script writes the public key into `electron/update_signing_key.ts` and prints the private key to stdout only — piped as above, it never touches the disk. Without `gh`, run the script alone, paste the printed PEM (including the `BEGIN`/`END` lines) into **Settings → Secrets and variables → Actions → New repository secret** as `UPDATE_SIGNING_PRIVATE_KEY`, then clear your terminal scrollback. **Keep an offline backup of the private key** (a password manager is fine): losing it means installs in the field can no longer be updated in place.

Recommended hardening: move the secret into a GitHub **environment** (for example `release`) with a deployment rule that admits only `v*` tags, and add `environment: release` to the `validate` and `publish` jobs. A repository secret is readable by any workflow someone with write access pushes; an environment secret is not.

### Losing or rotating the key

An install trusts only the key it was built with. There is no in-band rotation:

- **Lost or leaked key.** Generate a new one with `--force`, and tell users to install the next release by hand from the release page. Installs on the old key will refuse every update signed with the new one — which, for a leaked key, is the point.
- **Planned rotation.** Ship one release built with the *new* public key but signed with the *old* secret (the **Check the update signing key** step will refuse it, so that one release needs that check bypassed), then switch the secret. Installs that took the bridge release accept the new key from then on.

`generate-update-signing-key.mjs` refuses to replace a real key without `--force` for exactly this reason.

## OS code signing (optional)

The release workflow turns OS code signing on for a platform when its secrets exist and leaves it off otherwise, so a release never waits on a certificate. Add these as repository secrets:

| Secret | Platform | What it is |
| --- | --- | --- |
| `CSC_LINK` | macOS | Base64 of a **Developer ID Application** certificate exported as `.p12` (or an HTTPS URL to it) |
| `CSC_KEY_PASSWORD` | macOS | The `.p12` password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS | Notarization: your Apple ID, an [app-specific password](https://support.apple.com/102654), and your team ID |
| `WIN_CSC_LINK` | Windows | Base64 of a code-signing certificate exported as `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Windows | The `.pfx` password |

What to buy:

- **macOS:** an [Apple Developer Program](https://developer.apple.com/programs/) membership (USD 99/year) gives you the Developer ID certificate and notarization. Signed and notarized builds open without the Gatekeeper workaround. Self-update on macOS additionally needs a `zip` mac target and both arches built in one job — not done yet, so macOS stays notice-only.
- **Windows:** a code-signing certificate from a public CA. Since June 2023 new OV/EV certificates are issued only on hardware tokens or cloud HSMs, so most can no longer be exported to a `.pfx` for `WIN_CSC_LINK`. The practical options are [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) (about USD 10/month; electron-builder supports it through `win.azureSignOptions` plus `AZURE_*` secrets, which needs a small `package.json` change once you have an account) or SignPath's free tier for open-source projects. A signed installer sets `publisherName` in `app-update.yml`, and electron-updater then also checks the Authenticode publisher of every downloaded update.

Neither path has been exercised in CI yet: expect to iterate on the first signed release (for example macOS entitlements for notarization), and run it on the throwaway repo first.

## Packaged-build hardening

`build.electronFuses` in `app/package.json` flips Electron's fuses when electron-builder packages the app: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` / `NODE_EXTRA_CA_CERTS` and `--inspect` are ignored; only `app.asar` is loaded, with its integrity checked on macOS and Windows; cookies are encrypted at rest; and `file://` pages get no extra privileges. A side effect for users: a corporate root CA can no longer be added through `NODE_EXTRA_CA_CERTS` — it has to be trusted by the OS. The fuses only apply to packaged builds; `npm run dev` is unaffected.

Packaged builds also ignore `APIWEAVE_FRONTEND_DIST` and always serve the renderer they shipped with.

## Rehearsing the update path before users run it

`app.isPackaged` is false in dev, so electron-updater's own `isUpdaterActive()` refuses to check and `UpdateManager.runCheck` short-circuits. Left alone, the first execution of the real download-and-install path is on a user's machine.

`APIWEAVE_DEV_UPDATES=1` lifts both guards. electron-updater then reads [`app/dev-app-update.yml`](../../app/dev-app-update.yml) instead of the packaged `app-update.yml`, and everything downstream — provider, manifest parsing, sha512 verification, signature verification, install-on-quit — behaves exactly as it does in a shipped build. That includes refusing every update while `update_signing_key.ts` holds the placeholder, and refusing manifests signed by any key other than the embedded one.

```bash
cd app
APIWEAVE_DEV_UPDATES=1 npm run dev
```

```powershell
# PowerShell
cd app
$env:APIWEAVE_DEV_UPDATES = "1"; npm run dev
```

Then open **Settings → Updates** and use **Check for updates**. Watch the day's log file (the **Show update log** link in that panel reveals it) for the provider request, the resolved file and the sha512 result.

Two things to know before you read the result:

- **The dev app reports `package.json`'s version.** Against the real repo it will say you are up to date. To see an update offered, temporarily lower `version` in `app/package.json` — don't commit that.
- **Restarting really installs.** `quitAndInstall` runs the downloaded NSIS installer, which installs to the normal per-user location. That is the point of the test, but it is not a no-op on your machine.

### The throwaway-repo loop

Pointing a dev build at the production repo only tests the read path. To exercise a full release train, publish to a repo you can break:

1. Create an empty public repo, e.g. `apiweave-update-test`.
2. Copy `.github/workflows/desktop-release.yml` into it, and set `build.publish[0].url` and `build.publish[1].owner`/`repo` in `app/package.json` to that repo. Give it its own signing key: run `node scripts/generate-update-signing-key.mjs --force | gh secret set UPDATE_SIGNING_PRIVATE_KEY --repo <you>/apiweave-update-test` in that copy, never in this repo.
3. Set `version` to `0.0.1`, tag `v0.0.1`, push. Install the resulting installer for real.
4. Set `version` to `0.0.2`, tag `v0.0.2`, push.
5. Launch the installed `0.0.1`. It should notice `0.0.2` within the launch check, and — under **Automatic**, or after clicking **Download** — stage it and install on restart.

Point `app/dev-app-update.yml`'s `url` at the same repo to iterate without reinstalling between attempts.

Run this once per release train, not per commit. It is the only thing that catches a provider misconfiguration, and a provider misconfiguration is precisely the failure you cannot repair remotely.

## Pulling a bad release back

Two levers. Reach for them in this order.

### 1. Halt the rollout — fast, reversible, no unpublishing

Run the **Update rollout** workflow (`.github/workflows/update-rollout.yml`) with the tag and `percentage: 0`. It rewrites `stagingPercentage` in that release's manifests and re-uploads them; `version`, `path`, `sha512` and `apiweaveSignature` are untouched, and the signature does not cover the percentage, so no key is needed.

electron-updater compares a hash of a GUID it persists per install against `stagingPercentage / 100`, so:

- `0` admits nobody. Every client stops offering the update at its next check — within ~6 hours, or immediately on next launch.
- Buckets are **stable per install**. Raising 10 → 50 only ever adds installs; it never revokes one.
- Anyone who already updated stays updated. Staging gates *new* updates; it is not a rollback.

This only governs Windows and AppImage, the platforms that read the manifests. macOS and deb/rpm/pacman read `version.json`, which carries no staging — a bad release costs those users a notice they have not acted on, not a broken install.

Use the same workflow to stage a release deliberately: publish, set `10`, wait, then `100`.

### 2. Move the permalink back — every platform

Mark the bad release as a prerelease:

```bash
gh release edit v0.7.0 --repo Kaysharp42/apiweave --prerelease
```

`/releases/latest` skips prereleases, so the permalink — and with it `latest.yml`, `latest-linux.yml` and `version.json` — resolves to the previous good release again. Both paths recover, and the download URLs already in people's hands keep working, which deleting the release would break.

This does **not** downgrade anyone who already updated. `allowDowngrade` is off, so a client on the bad version simply stops being offered anything until a higher version exists. The fix is always to ship forward.

> Verify this on the throwaway repo before you need it in anger. The prerelease exclusion is documented for `/releases/latest`, but a rollback lever you have never fired is a hypothesis.

### Then ship the patch

Neither lever repairs an install that already updated. Bump the patch version, tag, and let the normal flow carry it — a client on the bad version picks up the higher one at its next check.

## Reading the log

`autoUpdater.logger` is electron-log, scoped `[updater]`. There is one file per day; a day past 10 MiB splits into timestamped chunks, and files older than 14 days are deleted.

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\APIWeave\logs\apiweave-main-YYYY-MM-DD.log` |
| macOS | `~/Library/Logs/APIWeave/apiweave-main-YYYY-MM-DD.log` |
| Linux | `~/.config/APIWeave/logs/apiweave-main-YYYY-MM-DD.log` |

**Settings → Updates → Show update log** reveals the file in the OS file manager. The file transport is pinned to `info`, which keeps electron-updater's per-byte-range debug chatter out while still recording every check, resolution, download and error.

Background checks — the one at launch and the recurring one — log their failures instead of surfacing them. A machine that is briefly offline is not a problem report, so the Updates panel stays quiet and the log is the record. An explicit **Check for updates** reports failures on screen, because someone is waiting for an answer.

## Known gaps

- **Nothing is OS code-signed yet.** Updates are protected by the [update signature](#update-signatures), but first installs are not: SmartScreen and Gatekeeper still warn, and a tampered installer downloaded by hand is caught only by `SHA256SUMS.txt`, which lives in the same release. See [OS code signing](#os-code-signing-optional) for what turns that on. The default policy stays **Notify me** until it is.
- **`version.json` is not signed.** It only drives a notice that links to the release page, never an install.
- **`version.json` exists because macOS ships as two single-arch jobs.** Each writes a `latest-mac.yml` describing only its own arch, so the finalize job deletes both rather than publish a manifest that is wrong by construction. Collapsing to one shared manifest means building both arches in one job, which is blocked on cross-arch `better-sqlite3` rebuilds.
- **No channel split.** Prereleases are excluded from `/releases/latest`, so they are invisible to the updater rather than routed to a beta channel. `autoUpdater.channel` is the hook if betas should ever absorb release risk.

## Related

- [Installation → Updates](../getting-started/installation.md#updates) — the user-facing behaviour
- `app/electron/updater.ts` — the update-channel decision, in full
- `app/electron/update_signature.ts` — the update signature check
- `.github/workflows/desktop-release.yml` — the release pipeline
- `.github/workflows/update-rollout.yml` — the staging/kill switch
