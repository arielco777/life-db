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
2. Merge `dev` into `main` (PR).
3. Tag `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag v1.0.1 && git push origin v1.0.1
   ```

   The workflow checks the tag against the app version and the release notes, then builds
   Windows (`.msi`, `-setup.exe`), macOS (universal `.dmg`) and Linux (`.AppImage`, `.deb`,
   `.rpm`), all signed for the updater. Last, it writes the notes into `latest.json`.
4. Open the draft release on GitHub and check it: the notes from `RELEASE_NOTES.md`, then the
   "Installing" section, the installers, their `.sig` files and `latest.json`.
5. **Publish.** Installed apps find it at their next daily check, or straight away with
   *Settings → About → Check now*.

## Notes

- **Unsigned installers** (DIST-1 note): Windows SmartScreen and macOS Gatekeeper ask once.
  The release notes explain what to click. Code signing can be added later through
  `tauri-action` secrets, with no change to the app.
- **Editing notes after the build** changes only the GitHub page. The app reads the notes
  in `latest.json`, which the workflow writes from `RELEASE_NOTES.md`. To change those too,
  edit `notes` in `latest.json` and upload it again to the release before publishing.
- The update check reads `releases/latest/download/latest.json`. "Latest" means the
  newest published release that isn't a draft or pre-release.
- **Database changes**: a release with new migrations upgrades the data on first start,
  after a `pre-migration-*` backup. All pending migrations run in one transaction, so a
  failure leaves the data unchanged (DIST-3).
