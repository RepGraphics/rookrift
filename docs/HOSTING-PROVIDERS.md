# Hosting provider connectors

Open **Operations → Hosting & backups**, choose a Rookrift game server and select **Connect hosting panel**. A provider link supplements that server's existing ARK RCON connection. It does not install a new server or turn RCON into a process-control protocol.

| Capability | Pterodactyl | Pelican | Nitrado |
| --- | --- | --- | --- |
| Report process state | Yes | Yes | Yes |
| Start / stop / restart | Yes | Yes | Yes, subject to service permissions |
| CPU / memory / disk usage and uptime | Yes | Yes | Unavailable |
| Create/list/check exact backup | Yes | Yes | Unavailable |
| Scheduled/verified backup workflows | Yes | Yes | Unavailable |
| Stopped-server INI deployment/rollback | Yes | Yes | Unavailable |

Controls, scheduling, workflows and configuration deployment check provider capabilities on the backend. Nitrado allocation figures are not presented as live process usage. Its backups/configuration stay in the provider panel for this release.

## Pterodactyl and Pelican

Supply the HTTPS panel origin, server's short identifier or UUID, and a **Client API** credential with access to that server. Application API credentials are unsuitable. Pelican uses its compatible client resources, power, file and backup endpoints; migration may preserve older key prefixes. The connector verifies the actual resource response instead of trusting a prefix.

Hosts must enable backup capacity and relevant client permissions. Configuration deployment requires file read/write access and an offline provider state. Existing exact-backup verification, encrypted rollback records and workflow action locks apply to both panels. TLS certificates are verified and redirects are rejected. Private panel destinations require the operator's explicit `ALLOW_PRIVATE_HOSTING=true` setting on a trusted network.

## Nitrado

Select **Nitrado**, enter the numeric **service ID**, and provide a Nitrado token with service access, preferably limited to that service. The origin is fixed to `https://api.nitrado.net`; arbitrary API hosts are rejected. Tokens are encrypted after a successful service-state check. Nitrado responses can contain FTP/database credentials and websocket tokens; Rookrift returns only its allowlisted state fields.

The adapter uses the documented game-server endpoints:

- `GET /services/{id}/gameservers` for service identity/state.
- `POST /services/{id}/gameservers/stop` and `/restart` for power requests.
- Starting requires a freshly reported `stopped` state and sends the provider-reported current game folder to `POST /services/{id}/gameservers/games/start`. The dashboard cannot supply a different game. The token may need Nitrado's game-change permission for this endpoint.

An accepted request means Nitrado accepted it; refresh state and RCON status to establish recovery. Nitrado supplies no reliable process uptime in this connector, so a restart workflow must observe a process transition before treating the new RCON response as recovered. An unchanged running state cannot prove a restart occurred.

Official contracts: [Nitrado API documentation](https://doc.nitrado.net/), [Pelican client routes](https://github.com/pelican-dev/panel/blob/main/routes/api-client.php). Adapter tests use representative responses; validate permissions and lifecycle behaviour on a pilot service before scheduling production restarts.

Other providers can be added behind the shared adapter and capability interface once their documented API is verified. Steam installations, provider restores, automatic mod updates and DayZ transport remain separate work.
