# Rookrift v0.3 operations

The dashboard now covers three kinds of work: reliability and automation, player/community administration, and connected hosting controls. Open **Operations** for health history, incidents, announcements, maintenance windows, hosting/backups, and moderation history. Player actions are also available directly under **Players**. The hosted preview simulates these workflows; the live Node deployment uses the authenticated backend.

## Hosting and provider backups

The implemented hosting adapter is **Pterodactyl's client API**. This version does not claim Nitrado, arbitrary Windows service control, or a native host agent. RCON remains independent of the hosting connection.

1. Add the game server's RCON connection normally.
2. In **Operations → Hosting & backups**, choose that server and click **Connect hosting panel**.
3. Enter the HTTPS panel origin, its server identifier (short ID or UUID), and a client API key. Use an account/subuser with access to the intended server and the resource, power, and backup permissions you actually require.
4. Rookrift verifies resources before saving the key encrypted. Check the panel server mapping carefully before using power controls: the configured RCON address and provider ID are user-selected and cannot be assumed to refer to the same process.
5. Use Start, Stop, Restart, or Create backup. Each request requires the exact Rookrift server name as confirmation. Save the world and enable maintenance before a planned disruptive change when appropriate.

Power requests are asynchronous acknowledgements, not proof that the process is already running/stopped. RCON status is cleared after a power request and collected again by monitoring. Refresh host status to inspect its reported process state, CPU, memory, disk, uptime, and backups. Hosting requests have a five-per-minute authenticated-user limit, and concurrent mutations on one server are rejected.

Creating a backup asks the provider to archive server files under its permissions, quota, storage, and billing rules. A returned acceptance is not a completed backup. Check completion and failure states. Restore, delete, download, and backup retention administration remain in the host panel. RCON SaveWorld is separate from these file archives.

Keys are never returned in bootstrap, connection, or resource responses. Leaving the key blank retains it only at the same panel origin; changing origins requires entering a new key. Disconnect removes the local encrypted credential and does not change the host process. HTTPS verification is mandatory. Redirects, URL credentials, non-origin paths, private/link-local targets, and excessive response bodies are rejected. `ALLOW_PRIVATE_HOSTING=true` is a separate operator-only opt-in for a trusted private panel; it does not disable TLS verification.

The adapter follows the provider's [client API routes](https://github.com/pterodactyl/panel/blob/1.0-develop/routes/api-client.php), [power controller](https://github.com/pterodactyl/panel/blob/1.0-develop/app/Http/Controllers/Api/Client/Servers/PowerController.php), and [backup controller](https://github.com/pterodactyl/panel/blob/1.0-develop/app/Http/Controllers/Api/Client/Servers/BackupController.php). Route/contract tests use an injected provider fixture. A real panel/account must still be exercised before selling this integration to customers.

## Player moderation and community announcements

Under **Players**, select Kick or Ban for a current server-reported identifier, review the identity and destination, and record an internal reason. The reason is not appended to the RCON command. Input identifiers are restricted to a single safe argument; targets must belong to a currently reported player in that workspace/server. A tracked ban can be reversed from **Operations → Moderation** using Unban and another reason.

The game-specific commands are `KickPlayer`, `BanPlayer`, and `UnbanPlayer`; see the [ARK community command reference](https://ark.wiki.gg/wiki/Cheat). IDs and support vary by game/platform/provider. Rookrift records command acknowledgement, not an independently verified ban state. Refresh the snapshot and check the game to confirm the outcome. An explicit game rejection is surfaced. The Players ? Ban lookup directory combines tracked records across clusters and offers exact-ID lookup of opt-in communities; see [the ban directory guide](BAN-DIRECTORY.md). There is no automatic cross-cluster ban enforcement or timed ban in this version. The moderation view shows up to 200 recent records and is not an imported game ban list.

The **Announcement library** stores welcome text, event notices, and reminders. Supported placeholders are `{server}`, `{map}`, `{players}`, and `{cluster}`. Preview the resolved message for each selected destination before confirming delivery. All recipients and final message lengths are validated before the first send; the RCON transport removes command separators and control characters from broadcasts. Results remain per server, including partial failures.

The clock icon copies a template into a new automation. The copied message has its own lifecycle; future edits/deletion of the template do not change existing copies. Scheduled broadcasts resolve supported placeholders at execution time using the current server values. A rendered message longer than 300 characters fails visibly and is not sent.

## Maintenance windows and execution history

Create weekly maintenance windows with selected servers, weekdays, local start time, duration, and an IANA time zone. Windows can span midnight, recur on several days, and overlap. Their interpretation follows the zone's wall clock, including daylight-saving gaps and repeated times; it is not a guarantee of a fixed number of elapsed UTC minutes across a clock change.

During an active window, scheduled commands are skipped, new outage incidents/connection alerts are suppressed, and monitoring/manual controls continue. Overlapping windows form a union. Ending/deleting a window never clears the manual maintenance preference. Failed checks during planned maintenance do not accumulate toward a subsequent unplanned-outage threshold. Plan-downgraded windows are paused; their saved settings remain.

Each automation now has **History**, listing up to 50 retained successful, failed, or skipped executions with start/finish times and detail. Run now preserves the next interval. Editing an automation resets its next interval; deleting it also removes its execution history. Per-task locking prevents concurrent manual/scheduled executions, and deletion is refused while a task is running. Execution history follows the plan's retention period.

## Health history, incidents, and notifications

Health history reports observed RCON availability, peak concurrent players, and the 95th-percentile successful-response latency. Choose a server, retained range, and plot metric. Samples are downsampled to roughly 96 time buckets. Missing intervals are not invented measurements; the interface distinguishes no data from zero. Availability is an authenticated RCON signal, not an independent game-process or application SLA.

In **Settings**, choose one to five consecutive failed monitoring checks before opening an outage incident. There is at most one open incident per server. Repeated failures update monitoring without opening duplicate incidents/alerts. Acknowledgement and private investigation notes help track ownership; acknowledgement does not resolve an outage. A successful authenticated check closes it automatically and creates a recovery notification.

The bell opens a persistent notification tray with unread counts and per-item/all-read controls. Outages, recoveries, failed automations, and accepted hosting requests appear there. Notification read state is scoped to the workspace. Discord connection alerts remain controlled by the workspace preference and maintenance state. Historical transition events remain in activity even when alerts are suppressed.

Internal server notes are editable with a connection's metadata and visible in its management dialog. They are ordinary private workspace data, not an encrypted secret field; keep passwords/API keys in their designated credential inputs.

## Limits and upgrade

| Plan | Announcement templates | Recurring windows | Retained metrics / runs / notifications |
| --- | ---: | ---: | ---: |
| Scout | 3 | 0 | 1 day |
| Tribe | 25 | 10 | 7 days |
| Cluster | 100 | 50 | 30 days |

Player moderation and the Pterodactyl connector are available for servers allowed by the current plan. Provider fees and game hosting remain separate. Closed incidents follow retention; unresolved incidents and tracked moderation records remain actionable within their documented views.

Before upgrading, stop the single application process and take a consistent database/WAL backup plus a separate encryption-key backup. Startup applies schema version 3 upgrades, including typed moderation identities and the opt-in ban directory. Review the [ban directory migration notes](BAN-DIRECTORY.md) before enabling sharing. Do not run mixed versions against one SQLite database. The Docker image includes both `server/` and the shared runtime helpers. Existing demo workspaces are upgraded locally without clearing prior edits. Verify the live game's identifiers, moderation behavior, panel permissions, backup completion, and outage/recovery path on test servers before broad launch.
