# Automatic server details (0.21)

New connections default to **Detect map/world and player capacity automatically**. These values can remain blank while discovery is pending. Existing connections keep their manual labels and limits until an administrator enables discovery in **Edit connection**. Turn it off to enter explicit overrides.

Open a server and select **Refresh detected details** to request discovery now. The details panel shows each detected value, its source and observation time. Unknown capacity is shown as unknown, rather than an invented slot count. Public pages, cards and support summaries use the resulting values.

## Sources and setup

| Game | Player limit | Map / world | Required connection |
| --- | --- | --- | --- |
| ARK Evolved | A2S_INFO; hosting startup fallback | A2S_INFO; hosting startup fallback | Actual UDP query port, or a supported host connection |
| ARK Ascended | Supported hosting API/startup configuration | Supported hosting API/startup configuration | Nitrado, Pterodactyl or Pelican; no assumed ASE query service |
| Minecraft Java | Native RCON `list`, Minecraft Query, hosting configuration | Minecraft Query or hosting `server.properties` | RCON for capacity; enable Query or connect hosting for the world |
| DayZ | A2S_INFO; hosting configuration fallback | A2S_INFO; hosting mission configuration/startup fallback | Actual UDP query port, or supported hosting access |

The **Query port** is separate from the RCON port. Enter the actual configured UDP query port for ASE/DayZ or Minecraft Query. If left blank, a supported hosting API may supply it; Rookrift does not scan port ranges or guess that RCON and query use the same port. Ports read from a hosting panel can differ from external NAT mappings, so an explicit query-port override takes priority.

For Minecraft, enable `enable-query=true` and configure `query.port` to use Query. Permit UDP from the Rookrift backend and restart the game after configuration changes. A normal native RCON player-list response already includes the maximum player count and requires no extra Query listener. Vanilla RCON does not return the world name; a connected Pterodactyl/Pelican panel can read only the relevant fields from `server.properties`. [Paper server properties](https://docs.papermc.io/paper/reference/server-properties/)

Pterodactyl and Pelican discovery reads allowed startup variables plus Minecraft's `server.properties` or DayZ's `serverDZ.cfg` where applicable. Tokens need startup/file read permissions. Nitrado discovery uses `gameserver.query.map`, `gameserver.query.player_max` and applicable configuration fields from its authenticated gameserver API. [Nitrado API](https://doc.nitrado.net/#api-Gameserver-Details)

Query/RCON responses describe what the service reports. **Hosting configuration is a fallback, not proof of active runtime settings:** it may await a restart or be overridden by a custom startup script/command. Each source is labelled accordingly. A custom launcher, mod or provider can prevent reliable inference; use manual overrides when needed. No player IDs, credentials, query payloads or full configuration files are published as metadata.

## Reliability and limits

- Metadata discovery is separate from RCON health. A query failure does not mark a working RCON connection offline.
- Successful values survive a later discovery failure, with their original observation times and a warning. A discovery attempt normally occurs about every five minutes; explicit refreshes have a 15-second cooldown. Minecraft RCON capacity also updates during normal player checks.
- Persisted timestamps avoid repeated probes after restarts. At most four metadata discoveries run together in each workspace. An unavailable source is cached for the same interval; it does not create a tight retry loop.
- Changing a server target, query settings, or hosting connection invalidates the relevant discovery state. Connection revisions prevent a slow reply from being applied after an edit. Workspace access, server scopes and plan limits also apply to discovery.
- UDP queries use the existing target validation and pinned-address policy, including the operator's private-network opt-in. Responses are size-bounded and parsed defensively. A2S supports challenges and uncompressed Source split packets, including reordered/duplicate fragments; compressed and older GoldSrc replies are rejected. Minecraft Query requires a matching session and full-stat response. [Valve query protocol](https://developer.valvesoftware.com/wiki/Server_queries)
- Discovery sends read requests only. It does not change game settings, restart servers or enable query listeners automatically.

Live read checks on the owner's test servers returned ASE **TheIsland / 4 players** through A2S, and Minecraft **world / 4 players** through the Pterodactyl configuration API. Local UDP fixtures additionally cover malformed, challenged and split responses. DayZ game installation remains deferred; no live DayZ query result is claimed.

## Upgrade

Schema **24** adds discovery settings, a revision counter and a small persisted metadata snapshot, and permits unknown capacity. Existing server labels and limits remain manual. There are no new packages or environment variables. Back up PostgreSQL before updating; a rollback requires the matching schema-23 database and application backup. Rebuild and restart the application normally.

## DayZ Steam fields in the test panel

The installed DayZ egg **52** defines `STEAM_USER` and `STEAM_PASS`, but both variables have `user_viewable=false` and `user_editable=false`. This hides them from the server's ordinary Startup page.

In [the panel's egg Variables page](https://panel.euphoriadevelopment.uk/admin/nests/egg/52/variables), enable **Users Can View** and **Users Can Edit** for both variables, saving each. This is an egg setting, so it affects every server using that egg. Enter the Steam values privately in the test server Startup page afterward. The supplied API keys can update server startup values but cannot edit egg-variable visibility; the supported [Application API exposes read-only nest/egg routes](https://github.com/pterodactyl/panel/blob/develop/routes/api-application.php). Browser control was unavailable in this session, so this panel change requires its administrator.

The test server remains stopped and uninstalled as requested. Exposing these fields does not initiate installation. Follow the installed template's Steam authentication requirements when you choose to install it; credentials stay out of this repository.
