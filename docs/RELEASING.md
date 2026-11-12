# Releasing Life DB

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a version tag
is pushed. The workflow creates a **draft** release. Nothing reaches users until you
publish it.

## One-time setup

1. **The updater key** (DIST-2). You made it with
   `./node_modules/.bin/tauri signer generate -w ~/.tauri/life-db.key`.
   - The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
   - Keep `~/.tauri/life-db.key` and its password safe, and back them up. If they're lost,
     installed copies can never accept another update.
2. **Two repository secrets**, under GitHub → Settings → Secrets and variables → Actions, or
   with `gh`:

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/life-db.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # prompts for the password
   ```

3. **The repository must be public.** The app downloads `latest.json` and the update
   packages from GitHub Releases without logging in, and "Report an issue" opens GitHub
   Issues. On a private repository, both fail for everyone else.

## Each release

1. On a branch from `dev`, set the version everywhere and open a PR into `dev`:

   ```bash
   npm run version:set 1.0.0      # package.json, tauri.conf.json, Cargo.toml, Cargo.lock
   ```

   `npm run version:check` prints the version and fails if the files disagree.
2. Merge `dev` into `main` (PR).
3. Tag `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag v1.0.0 && git push origin v1.0.0
   ```

   The workflow checks that the tag matches the app version, then builds Windows
   (`.msi`, `-setup.exe`), macOS (universal `.dmg`) and Linux (`.AppImage`, `.deb`, `.rpm`),
   all signed for the updater, plus `latest.json`.
4. Open the draft release on GitHub and **replace the first line of the notes with what's
   new**. The app shows these notes before installing (Markdown works). Keep the
   "Installing" section.
5. **Publish.** Installed apps find it at their next daily check, or straight away with
   *Settings → About → Check now*.

## Notes

- **Unsigned installers** (DIST-1 note): Windows SmartScreen and macOS Gatekeeper ask once.
  The release notes explain what to click. Code signing can be added later through
  `tauri-action` secrets, with no change to the app.
- The update check reads `releases/latest/download/latest.json`. "Latest" means the
  newest published release that isn't a draft or pre-release.
- **Database changes**: a release with new migrations upgrades the data on first start,
  after a `pre-migration-*` backup. All pending migrations run in one transaction, so a
  failure leaves the data unchanged (DIST-3).
