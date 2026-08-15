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

1. **validate** — checks the tag shape, that `app/package.json` and `app/package-lock.json` agree with it, and that the tag is on `main`. Creates the draft release, so the four build jobs can only ever *find* it rather than race to create it.
2. **build** (×4) — each job packages and publishes its own installers straight to the draft. Publishing is what makes electron-builder write `latest.yml` / `latest-linux.yml` and the differential blockmaps; `--publish never` produces none of them.
3. **publish** — verifies the full asset set landed, verifies the manifests are internally true (below), writes `version.json`, checksums everything, then flips the release live.

### What CI actually guarantees

The **Verify update manifests** step asserts, for both `latest.yml` and `latest-linux.yml`:

- the `version` in the manifest equals the tag
- the file named in `path` exists in the release
- its base64 sha512 matches the bytes actually published

That is the check that a manifest is *true*, as distinct from merely *present*. It matters because those manifests became load-bearing when the generic provider went first: a manifest that disagrees with its own release breaks updates for every installed client, and a broken update channel cannot be fixed through the update channel.

`SHA256SUMS.txt` deliberately excludes `latest*.yml` — they are updater metadata rather than human downloads, they already carry their own sha512, and the rollout workflow rewrites them in place.

> **CI does not prove the updater works.** It proves the assets are coherent. Those are different claims, and only the next section closes the gap.

## Rehearsing the update path before users run it

`app.isPackaged` is false in dev, so electron-updater's own `isUpdaterActive()` refuses to check and `UpdateManager.runCheck` short-circuits. Left alone, the first execution of the real download-and-install path is on a user's machine.

`APIWEAVE_DEV_UPDATES=1` lifts both guards. electron-updater then reads [`app/dev-app-update.yml`](../../app/dev-app-update.yml) instead of the packaged `app-update.yml`, and everything downstream — provider, manifest parsing, sha512 verification, install-on-quit — behaves exactly as it does in a shipped build.

```bash
cd app
APIWEAVE_DEV_UPDATES=1 npm run dev
```

```powershell
# PowerShell
cd app
$env:APIWEAVE_DEV_UPDATES = "1"; npm run dev
```

Then open **Settings → Updates** and use **Check for updates**. Watch `main.log` (the **Show update log** link in that panel reveals it) for the provider request, the resolved file and the sha512 result.

Two things to know before you read the result:

- **The dev app reports `package.json`'s version.** Against the real repo it will say you are up to date. To see an update offered, temporarily lower `version` in `app/package.json` — don't commit that.
- **Restarting really installs.** `quitAndInstall` runs the downloaded NSIS installer, which installs to the normal per-user location. That is the point of the test, but it is not a no-op on your machine.

### The throwaway-repo loop

Pointing a dev build at the production repo only tests the read path. To exercise a full release train, publish to a repo you can break:

1. Create an empty public repo, e.g. `apiweave-update-test`.
2. Copy `.github/workflows/desktop-release.yml` into it, and set `build.publish[0].url` and `build.publish[1].owner`/`repo` in `app/package.json` to that repo.
3. Set `version` to `0.0.1`, tag `v0.0.1`, push. Install the resulting installer for real.
4. Set `version` to `0.0.2`, tag `v0.0.2`, push.
5. Launch the installed `0.0.1`. It should notice `0.0.2` within the launch check, and — under **Automatic**, or after clicking **Download** — stage it and install on restart.

Point `app/dev-app-update.yml`'s `url` at the same repo to iterate without reinstalling between attempts.

Run this once per release train, not per commit. It is the only thing that catches a provider misconfiguration, and a provider misconfiguration is precisely the failure you cannot repair remotely.

## Pulling a bad release back

Two levers. Reach for them in this order.

### 1. Halt the rollout — fast, reversible, no unpublishing

Run the **Update rollout** workflow (`.github/workflows/update-rollout.yml`) with the tag and `percentage: 0`. It rewrites `stagingPercentage` in that release's manifests and re-uploads them; `version`, `path` and `sha512` are untouched.

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

`autoUpdater.logger` is electron-log, scoped `[updater]`. The file rotates at 1 MiB into `main.old.log`.

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\APIWeave\logs\main.log` |
| macOS | `~/Library/Logs/APIWeave/main.log` |
| Linux | `~/.config/APIWeave/logs/main.log` |

**Settings → Updates → Show update log** reveals the file in the OS file manager. The file transport is pinned to `info`, which keeps electron-updater's per-byte-range debug chatter out while still recording every check, resolution, download and error.

Background checks — the one at launch and the recurring one — log their failures instead of surfacing them. A machine that is briefly offline is not a problem report, so the Updates panel stays quiet and the log is the record. An explicit **Check for updates** reports failures on screen, because someone is waiting for an answer.

## Known gaps

- **Nothing is code-signed.** With no `publisherName` in `app-update.yml`, electron-updater skips its Authenticode publisher check entirely; what remains is HTTPS plus a sha512 that arrives down the same channel as the download it vouches for. The user approving each version is the only real verification, which is why the default policy is **Notify me** and not **Automatic**. Windows signing (Azure Trusted Signing, or SignPath's open-source tier) is what makes that check real; macOS Developer ID + notarization would additionally let macOS leave the notice-only path.
- **`version.json` exists because macOS ships as two single-arch jobs.** Each writes a `latest-mac.yml` describing only its own arch, so the finalize job deletes both rather than publish a manifest that is wrong by construction. Collapsing to one shared manifest means building both arches in one job, which is blocked on cross-arch `better-sqlite3` rebuilds.
- **No channel split.** Prereleases are excluded from `/releases/latest`, so they are invisible to the updater rather than routed to a beta channel. `autoUpdater.channel` is the hook if betas should ever absorb release risk.

## Related

- [Installation → Updates](../getting-started/installation.md#updates) — the user-facing behaviour
- `app/electron/updater.ts` — the update-channel decision, in full
- `.github/workflows/desktop-release.yml` — the release pipeline
- `.github/workflows/update-rollout.yml` — the staging/kill switch
