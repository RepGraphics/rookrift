# Multiple games and online delivery (0.20)

Rookrift now offers ARK Ascended, ARK Evolved, Minecraft Java and DayZ workspace focuses, server connections, catalog products, applications and game filters. Mixed workspaces can combine them. Each workspace keeps its own subscription, team, page, store and quotas. Prices and quotas are unchanged.

Minecraft Java and DayZ adapters are **beta**: local TCP/UDP protocol fixtures, persistence, API and UI tests pass; live game-server validation is still required. Existing ARK connections are preserved. Minecraft Bedrock is not supported by this adapter.

## Available controls

| Capability | ARK Ascended / Evolved | Minecraft Java beta | DayZ beta |
| --- | --- | --- | --- |
| Connection | Source RCON, TCP | Source RCON, TCP | BattlEye RCON, UDP |
| Status / players | `ListPlayers` | Vanilla English `list` response | BattlEye `players` response |
| Broadcast | Game-specific ARK command | `say` | `say -1` (plain ASCII) |
| Save current world | `SaveWorld` | `save-all flush` | Unavailable |
| Kick / ban / unban | Server-reported ARK identifier | Exact username, `kick` / `ban` / `pardon` | GUID ban only, `addBan <guid> 0` |
| Shop recipient default | ASA EOS ID / ASE Steam64 | Java username | BattlEye GUID |
| Native chat proof `/link CODE` | Available | Unavailable | Unavailable |
| Versioned config deployment | ARK INI templates | Unavailable | Unavailable |

Unsupported operations are checked in the backend before execution. Bulk actions validate every selected game before sending any command. Schedules/workflows also reject unsupported game actions. DayZ kicks require transient player slots and unbans require ban-list indexes; Rookrift does not guess those from a GUID. Use an external verified administration workflow for these operations.

Process start/stop/restart and backups require a compatible hosting connector; RCON alone cannot start a stopped process. Rookrift does not install a game server by adding its RCON connection. Status indicates an RCON response, not a verified public game connection or full host health. Server capacity is the configured maximum, not necessarily a value returned by native player lists.

## Minecraft Java setup

Enable `enable-rcon=true` in `server.properties`, set a strong `rcon.password`, and choose `rcon.port` (typically 25575). Restart the server after changing these settings. Allow only the Rookrift backend to reach the RCON TCP port. Connect with **Minecraft Java** selected and enter the actual port/password. [Paper server.properties reference](https://docs.papermc.io/paper/reference/server-properties/)

Player parsing supports the vanilla English response `There are N of a max of M players online: ...`. Plugins or translated/custom responses may require a dedicated parser. Unsupported formats fail explicitly instead of replacing saved players with an invented empty list. Usernames are separate from UUIDs; a plugin must support UUID-addressed commands if you configure UUID delivery. Saved Minecraft delivery identities are self-reported, not ownership-verified.

## DayZ setup

Enable BattlEye and configure a strong `RConPassword`, `RConIP` and a dedicated `RConPort` in the server's BattlEye configuration (`BEServer_x64.cfg` for the relevant Windows server setup). Use the actual file/path supported by your host and restart as required. Allow the Rookrift backend to reach that **UDP** port. The editor suggests 2306; it must match your configuration and avoid existing ports. It is not automatically the game/query port. [DayZ server configuration](https://community.bistudio.com/wiki/DayZ:Server_Configuration), [BattlEye commands](https://community.bistudio.com/wiki/BattlEye)

The transport checks CRCs, acknowledges server messages, assembles reordered/duplicate multipart replies, bounds response sizes and logs out after each operation. It sends each game command once; a lost reply is not a reason to repeat a potentially successful command. Native player snapshots omit the network addresses returned by BattlEye and retain names and GUIDs. [BattlEye protocol](https://www.battleye.com/downloads/BERConProtocol.txt)

Use a 32-character BattlEye GUID for native player administration, not Steam64, EOS or a character UID. A saved DayZ GUID is self-reported. Native BattlEye does not provide inventory-item grants. DayZ items need staff fulfillment or a separately tested compatible mod/API; arbitrary ARK commands will not work.

## Wait until the recipient is online

Open **Community hub > Store > Products > Purchase actions**. Each server command now has **Wait until the recipient is online on this server**. It is opt-in, so existing purchase snapshots keep their behavior. It requires the native account identifier: ASA EOS ID, ASE Steam64, Minecraft username or DayZ BattlEye GUID. Numeric ARK character IDs and plugin/UUID identities cannot use this check because Rookrift cannot safely match them to native player lists.

Immediately before claiming a command for execution, the worker requests a fresh player list from the exact target server. An absent recipient or unavailable connection leaves the job pending without incrementing its execution attempts or sending the purchase command. It checks again after a minute, within the existing seven-day pending window. After that window, the job requires staff review. Presence checks are read-only and can be retried. Commands with an uncertain response after sending stop for manual review and are never automatically replayed.

Presence is a preflight, not an inventory receipt: a player may disconnect between the check and the command. A response means the server acknowledged the command, not that an item reached an inventory. The queue retains ordered actions, target fingerprints, immutable order snapshots and cancellation/refund review. Discord role actions keep their existing behavior. The browser demo simulates presence and command acknowledgements; it never connects to a real server.

Templates accept `{identifier}` and `{order_id}`; Minecraft literal JSON/NBT braces are preserved. Commands remain single-line, bounded and validated. For example, `give {identifier} minecraft:stone 1` addresses a Minecraft username. Validate the exact command against your game and plugins before selling it. Rookrift does not convert EOS/Steam identities into ARK numeric character IDs.

## Research and next steps

Tebex documents commands that wait for online players, and GameServerApp exposes pending/finished deliveries and delivery conditions. This release adds an explicit online preflight and game-specific capability handling around the existing durable queue. [Tebex command troubleshooting](https://docs.tebex.io/creators/command-management/command-troubleshooting), [GSA deliveries](https://docs.gameserverapp.com/dashboard/monetization/deliveries/), [GSA blueprints](https://docs.gameserverapp.com/dashboard/blueprints/create_and_manage_blueprints/)

The next commerce milestones are recurring supporter packages with expiry/refund/revocation actions, package prerequisites/upgrades and inventory-confirming plugins. These need their own lifecycle, reconciliation and game/plugin guarantees; they are not implemented in 0.20. [Tebex command lifecycle](https://docs.tebex.io/creators/command-management/an-introduction-to-commands), [Tebex package creation](https://docs.tebex.io/creators/tebex-control-panel/how-to-create-packages/how-to-create-a-package)

Operators remain responsible for game-specific monetization rules: review the current [Minecraft usage guidelines](https://www.minecraft.net/en-us/usage-guidelines) and [Bohemia monetization requirements](https://www.bohemia.net/en/monetization/faq) for the server and products you run. Rookrift is a management tool, not Tebex or a merchant-of-record service.

## Deployment

Back up PostgreSQL before updating. Schema **23** expands game constraints on workspaces, servers, products, applications and saved member identities. It adds no dependencies or environment variables. Existing credentials and product/order snapshots are preserved. Run the normal migration/startup path and rebuild the application. Older software cannot handle the newly added game records; rollback requires the matching pre-upgrade database and application backup.

No live Minecraft/DayZ test server was modified for this release. Validate connection, native player format, announcements, moderation and a non-chargeable delivery on your own pilot servers before offering paid fulfillment.
