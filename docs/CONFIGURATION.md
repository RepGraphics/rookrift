# Versioned configuration templates

Open **Configuration** for reusable, versioned game settings. Release 0.24 adds a preset library, a guided setting builder, filtered file import, local comparison, duplication and searchable/sortable saved templates. ARK supports guarded deployment through a compatible host connector; Minecraft Java and DayZ support native-format manual patch exports.

## Preset library

Choose **Preset library**, select a game and filter by category or search. **Use preset** opens an editable draft; nothing is created until saving and no game server is changed by selection or saving. The selected tab persists in the dashboard URL across reloads.

| Game | Included presets | File / delivery |
| --- | --- | --- |
| ARK Ascended / Evolved | Standard rate baseline, boosted weekend, cooperative world, faster breeding, longer daylight | `GameUserSettings.ini` or `Game.ini`; guarded host deployment |
| Minecraft Java | Community survival, creative building, shorter view distances, whitelist access | `server.properties`; manual patch export |
| DayZ | Accelerated clock, first-person survival, protected bases | `serverDZ.cfg` library label; manual patch export |

These are example partial patches, not complete server configurations, current official event rates or guaranteed performance improvements. Review the values, game build and mods. The ARK breeding preset does not guarantee full imprinting. Add your Minecraft accounts to the whitelist before enforcing it. The DayZ camera preset uses the `thirdPersonView` setting for version 1.30 or newer; its base-protection preset is not a complete PvE system.

## Guided creation tools

- **Guided builder:** search friendly labels or setting keys, add settings, adjust numbers and choices, and remove unwanted entries. It places ARK settings in the correct file/section. The generated patch is available for review. Guided edits regenerate formatting while retaining other simple INI entries already in the draft.
- **Text editor:** edit an ARK INI patch directly, or supported scalar Minecraft/DayZ settings. Switching back validates the draft first. Unsupported array operations and complex structures need manual panel editing.
- **Import settings:** select a UTF-8 file up to 256 KiB. Import replaces the draft with recognised gameplay settings for the chosen game/file. Credentials, RCON/API details, unsupported settings and nested DayZ classes are excluded. Duplicate recognised settings and invalid values are rejected. Only the extracted patch can be saved; the uploaded source is not sent to the server or stored in browser storage.
- **Compare with a file:** compare the draft locally against a selected file. Only targeted changes are displayed. This does not read from or write to a live server. Editing the patch clears the old comparison.
- **Copy / Download patch:** export the current validated draft, even before saving. Downloads end in `.patch` to distinguish these fragments from complete server files. Merge them through your panel; never replace an entire configuration with a patch.
- **Duplicate:** copy a saved template into a separate editable draft. Saving starts revision 1 for the copy and leaves the source and its history intact.

The saved library can be filtered by game, searched by name/game/file/note and sorted by update time, name or game. Saving uses the existing workspace template allowance. Presets themselves consume no allowance until a copy is saved.

## Templates and versions

Create a template for one game and its supported file. ARK uses `[sections]` and simple `Key=Value` settings. Minecraft uses `key=value`; DayZ uses numeric `key = value;` assignments from the guided catalogue. Each save creates an immutable revision; the latest 20 are retained. Browse/download old revisions or restore their content as a new revision. Game and filename cannot change after creation; create a separate template instead.

The patch format supports 1–100 unique section/key pairs, at most 16,000 characters. Repeated keys, Unreal array operators and multiline values need manual editing. Credential, webhook/licence/API-key and RCON-related settings are rejected. Validate the actual game's supported setting names and values: this is an INI patch manager, not a complete ARK configuration schema or mod editor.

Managed ARK patches preserve unrelated settings and comments, including credentials already present in the remote file. Previews return only the targeted changed keys; full server files and encrypted original snapshots are not returned by dashboard APIs. Source files must be supported UTF-8 text, at most 256 KiB. Other encodings and larger files require the hosting panel.

Minecraft and DayZ patches can be versioned, imported, compared locally, copied and downloaded. Live preview/apply endpoints reject these export types before contacting a host. Minecraft exports do not change authentication, RCON, plugins or world-generation settings. DayZ's active file name is selected by the `-config` startup argument; `serverDZ.cfg` is a library label, not a universal path. Preserve the mission block and all required settings in that active file. Arrays, scripts, XML economy files, mod configuration and plugin formats are outside this editor.

## Preview and deploy

1. For an ARK template, connect a verified file-capable hosting panel (Pterodactyl or Pelican) with file-read/file-write and resource permissions. Choose a server running the template's game.
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

PostgreSQL migration 26 expands the configuration library's game/file constraint while preserving existing ARK records and revisions. Back up PostgreSQL before upgrading and keep the encryption key. Version 0.23 cannot use schema 26; rollback needs its matching schema-25 backup. No new dependencies or environment variables are required. Use one stop-first application replica. The demo uses synthetic files and simulated host state; no real server configuration is changed there.

Setting names and file formats were checked against the [ARK official community configuration reference](https://ark.wiki.gg/wiki/Server_configuration), [PaperMC server.properties reference](https://docs.papermc.io/paper/reference/server-properties/) and [Bohemia DayZ server configuration reference](https://community.bistudio.com/wiki/DayZ:Server_Configuration). The catalogue is a supported subset, not a complete configuration schema. Verify compatibility on your own game build before deployment.

Provider behaviour is based on the official Pterodactyl [file controller](https://github.com/pterodactyl/panel/blob/1.0-develop/app/Http/Controllers/Api/Client/Servers/FileController.php) and [client API routes](https://github.com/pterodactyl/panel/blob/1.0-develop/routes/api-client.php). Validate permissions and paths on a test server before production use.
