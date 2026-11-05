# Versioned configuration templates

Rookrift 0.8 adds **Configuration** to the dashboard. Store reusable ASE/ASA INI patches, compare them against a selected server, deploy through Pterodactyl and keep an encrypted original-file rollback snapshot.

## Templates and versions

Create a template for one game and either `GameUserSettings.ini` or `Game.ini`. Enter `[sections]` and simple `Key=Value` settings. Each save creates an immutable revision; the latest 20 are retained. Browse/download old revisions or restore their content as a new revision. Game and filename cannot change after creation; create a separate template instead.

The patch format supports 1–100 unique section/key pairs, at most 16,000 characters. Repeated keys, Unreal array operators and multiline values need manual editing. Credential, webhook/licence/API-key and RCON-related settings are rejected. Validate the actual game's supported setting names and values: this is an INI patch manager, not a complete ARK configuration schema or mod editor.

Patches preserve unrelated settings and comments, including credentials already present in the remote file. Previews return only the targeted changed keys; full server files and encrypted original snapshots are not returned by dashboard APIs. Source files must be supported UTF-8 text, at most 256 KiB. Other encodings and larger files require the hosting panel.

## Preview and deploy

1. Connect a verified Pterodactyl panel with the necessary file-read/file-write permissions, as well as resource access. Choose a server running the template's game.
2. Select the real server directory, `WindowsServer` or `LinuxServer`. Paths are fixed to `/ShooterGame/Saved/Config/<directory>/<filename>` inside the panel's server root. Arbitrary file paths are not accepted.
3. Generate a change preview. Check every current/proposed value, revision, path and provider state.
4. Stop the game process through **Operations → Hosting & backups**. Generate a fresh preview and type the exact server name to apply.
5. Rookrift commits an encrypted original-file snapshot before writing, then reads back and verifies the resulting file. Start the server separately when ready and check its behaviour.

A changed template, target or source file invalidates the preview. Provider-action locks and persisted operation markers prevent Rookrift workflows, connection changes and competing host actions from interfering with a file write. Pterodactyl file APIs do not offer an atomic compare-and-swap for other panel clients: avoid simultaneous edits through other tools. Stop/start are separate explicit host controls; applying a template does not silently restart the game.

## Rollback and uncertainty

Deployment history records actor, target, revision and result. To roll back, stop the server and confirm its exact name. Rookrift will restore and verify the original file only when the current file matches the known before/after state and the hosting target is unchanged. It refuses to overwrite newer unrelated edits or apply a snapshot to a different panel server.

If a write times out or the runtime is interrupted, its result is **uncertain**. No write is automatically replayed. New workflows and connection/host changes remain blocked for that target; a manual stop is still available. **Check file outcome** compares the remote file against the known hashes and can resolve the status without another write. Alternatively use guarded rollback. If neither hash matches, inspect/repair the file through the panel before removing the uncertain record.

Up to 50 rollback records are retained per workspace until an administrator removes them. Removing a record deletes its encrypted original-file copy, not the game file. Removing a template deletes its revision library but preserves deployment rollback records. Removing a server connection removes its associated records. Keep PostgreSQL backups and the original encryption key; snapshots cannot be decrypted without it. These snapshots back up configuration files, not game worlds.

## Access, limits and upgrade

Owners and unrestricted administrators can edit the shared template library. Staff can read its patch versions. Administrators can preview/apply/roll back only permitted, plan-entitled servers; deployment history is filtered by scope. Viewers and moderators cannot deploy files. Configuration templates have a separate stored-record allowance matching the announcement template allowance: Scout 3, Tribe 25, Cluster 100. Plan prices are unchanged.

PostgreSQL migration 3 adds workflow/configuration tables without replacing existing records. No new environment variables are required. Use one stop-first application replica. The demo uses synthetic files and simulated host state; no real server configuration is changed there.

Provider behaviour is based on the official Pterodactyl [file controller](https://github.com/pterodactyl/panel/blob/1.0-develop/app/Http/Controllers/Api/Client/Servers/FileController.php) and [client API routes](https://github.com/pterodactyl/panel/blob/1.0-develop/routes/api-client.php). Validate permissions and paths on a test server before production use.
