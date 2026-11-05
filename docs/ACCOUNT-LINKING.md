# In-game account linking

Release 0.11 connects the public member flow to native ARK chat monitoring. It fixes the former dependency on a working hosting-console connection, sender parsing, duplicate code consumption and the missing member interface.

## Player flow

1. Sign in to the community page and open **Game accounts**.
2. Join one of its published, plan-entitled ARK servers. Select that same world and generate a link code.
3. Send the complete `/link RR-...` command in **global player chat**. Do not enter it into the server console, a private message or a Discord channel.
4. Keep the community page open. It checks progress every three seconds and shows the linked identifier after verification. The confirmation is on the website; no in-game reply is required.

Codes expire after ten minutes, are bound to the selected server and game, and are stored as hashes. Generating a replacement invalidates the previous code. Only one successful verification consumes a code, even when a message is observed more than once. A verified game identifier cannot be claimed by a different member in the same workspace/game. Members can remove their own saved account. Manual identifiers remain clearly marked self-reported.

## Native monitoring and diagnostics

Rookrift polls `GetChat` through the server's configured RCON connection while a code is active. No panel connection or log-agent container is required. The read shares the normal per-server command guard; busy verification records wait briefly rather than losing an already-read chat command. The server still needs to be connected and entitled by its workspace plan.

Open **Community hub → Account linking** for per-server native-chat and console status. An idle state is expected when no member has an active code. An unavailable native read means you should check RCON, the running game and firewall. An unsupported `GetChat` needs a compatible server extension instead. Another tool reading the game's chat queue may prevent Rookrift from seeing the same messages on some server setups.

For native ARK output, Rookrift accepts a complete `AccountName (CharacterName): /link CODE` record (or an account-name-only variant), then refreshes `ListPlayers`. It matches the full outer sender against **all** currently reported account names. Quoted commands, nested `[chat]` fragments, duplicate names and ambiguous account/character prefixes cannot verify a link. If your server uses an unsupported log/chat format, a player has disconnected, or names collide, the code remains unverified. Use unique platform account names and retry with a fresh code.

Native verification correlates game-reported chat names with a fresh player snapshot. Native protocols do not supply a cryptographic sender-identity contract or universally consistent escaping. For stronger provenance, use a trusted server extension that obtains the identifier from the actual player controller. Never infer Steam/EOS ownership from a name in an arbitrary console log.

ASE/ASA format references: [pyARKon native chat output](https://github.com/nuthing/pyARKon/blob/master/__main__.py), [ASA chat client](https://github.com/dkoz/ascension-bot/blob/main/cogs/server/chatlog.py).

## Hosting consoles

Pterodactyl/Pelican streams are optional wake-up signals. Rookrift waits for authentication, requests bounded log history, renews tokens by asking the panel for a fresh session and reconnects after closure. Console text never directly verifies a player. WebSocket endpoints must use verified WSS and follow the existing public/private hosting-network policy. Nitrado does not provide console streaming through this connector; native RCON monitoring is independent.

References: [Pterodactyl WebSocket lifecycle](https://github.com/pterodactyl/panel/blob/1.0-develop/resources/scripts/components/server/WebsocketHandler.tsx), [Wings console history](https://github.com/pterodactyl/wings/blob/develop/router/websocket/websocket.go).

## Trusted server extension

An owner/administrator can issue a per-server token under **Account linking → Advanced server extension or log bridge**. The raw token is shown once and its hash is stored. Issuing another revokes the previous token. Keep it on the game host.

An authenticated extension can POST to `/api/link-events` with `Authorization: Bearer <server-token>` and a JSON body:

```json
{"server_id":"your-server-uuid","code":"RR-CODE-FROM-PLAYER","identifier":"controller-derived-account-id"}
```

The extension must derive the identifier from the actual chat controller, never parse a buyer-supplied identifier from message text. Rookrift checks that the identifier appears in a fresh server player snapshot, and applies the same server/game/expiry/ownership rules. ASE/ASA extension references: [ASE chat command callbacks](https://github.com/Michidu/ARK-Server-API/blob/master/version/Core/Public/ICommands.h), [ASA chat command callbacks](https://github.com/ServersHub/ServerAPI/blob/main/AsaApi/Core/Public/ICommands.h). No extension binary is bundled in this release.

The optional `link-agent` Compose profile forwards raw log lines only as a prompt to check native chat. Set `LINK_LOG_HOST_PATH` to an **existing host directory**, mounted read-only at `/logs`, and `LINK_LOG_PATH` to the file inside that mount (for example `/logs/server.log`). Set the endpoint, server ID and token privately, then start `docker compose --profile link-agent up -d --build link-agent`. Its health check is disabled because it does not serve HTTP. It tails new lines, bounds reads and retries transient forwarding failures. Old file history is skipped. This bridge is not a substitute for controller-derived identity when native `GetChat` is unavailable.

## Upgrade and demo

Migration 16 adds server-bound codes and verification provenance. Back up PostgreSQL before updating. Pre-upgrade codes have no server binding; generate a fresh code after upgrading. Existing identifiers are retained as self-reported and require fresh verification because the former name-only log parser could not establish reliable provenance. DayZ linking remains unavailable until a tested DayZ adapter exists.

The hosted demo offers an explicit **Simulate in-game link** control. Its simulated identities stay in browser storage and never connect to game servers.
