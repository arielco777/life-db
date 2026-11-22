# Releasing Life DB

Releases are automatic. When `main` gets an app version that hasn't been released yet,
GitHub Actions (`.github/workflows/release.yml`) builds every platform and **publishes**
the release. Installed apps then find the update. Pushes to `main` that keep an already
released version do nothing, so merging `dev` without a version bump is safe.

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

1. On a branch from `dev`, set the version everywhere, write the release notes, and open a
   PR into `dev`:

   ```bash
   npm run version:set 1.0.1      # package.json, tauri.conf.json, Cargo.toml, Cargo.lock
   ```

   Then replace `RELEASE_NOTES.md` with what's new in this version. It must start with
   `# Life DB 1.0.1` (the new version), followed by the notes in Markdown. Keep them short:
   the app shows them in its update dialog before installing.

   - `npm run version:check` prints the version and fails if the files disagree.
   - `node scripts/release-notes.mjs check v1.0.1` fails if the notes are for another
     version, empty, or still contain placeholder text (`TODO`, `TBD`, "replace this").
2. Merge `dev` into `main` (PR). That's the release. The workflow:
   - reads the version and stops if `v1.0.1` is already released;
   - checks `RELEASE_NOTES.md` is for 1.0.1, failing the run (and releasing nothing) if not;
   - builds Windows (`.msi`, `-setup.exe`), macOS (universal `.dmg`) and Linux (`.AppImage`,
     `.deb`, `.rpm`), all signed for the updater, into a draft;
   - once all three built, writes the notes into `latest.json` and publishes. GitHub creates
     the `v1.0.1` tag on the merged commit at that moment.

   If any build fails, nothing is published. Fix the cause on `dev`, merge again, and the
   run starts over: it deletes the leftover draft first. To retry without a new commit, use
   *Actions → Release → Run workflow* on `main`.
3. Installed apps find the update at their next daily check, or straight away with
   *Settings → About → Check now*. Check the release page if you like: the notes from
   `RELEASE_NOTES.md`, then the "Installing" section, the installers, their `.sig` files
   and `latest.json`.

## Notes

- **Unsigned installers** (DIST-1 note): Windows SmartScreen and macOS Gatekeeper ask once.
  The release notes explain what to click. Code signing can be added later through
  `tauri-action` secrets, with no change to the app.
- **Editing notes after the release** changes only the GitHub page. The app reads the notes
  in `latest.json`, which the workflow writes from `RELEASE_NOTES.md`. To change those too,
  edit `notes` in `latest.json` and upload it again to the release.
- **Pulling a bad release**: mark it as a pre-release (or delete it) on GitHub, so
  `latest.json` points back at the previous one, then release a fixed version. Never reuse
  a version number: apps that installed it won't update to the same number again.
- The update check reads `releases/latest/download/latest.json`. "Latest" means the
  newest published release that isn't a draft or pre-release.
- **Database changes**: a release with new migrations upgrades the data on first start,
  after a `pre-migration-*` backup. All pending migrations run in one transaction, so a
  failure leaves the data unchanged (DIST-3).
