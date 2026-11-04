# Unified ban directory

Release 0.6 stores the directory in PostgreSQL. For a previous SQLite installation, use the explicit [Dokploy and database migration guide](DOKPLOY.md); the legacy schema-v3 notes below describe the earlier SQLite upgrade only.

Open **Players → Ban lookup**, or choose **Check bans** beside a connected player to prefill the identifier. This feature is included in all plans; it does not consume an extra server slot or change the current plan’s server limits.

The private **Your cluster ban list** groups the workspace’s Rookrift ban records by identifier, cluster, and game, with active-server counts and first/last report dates. Filter by game and active/withdrawn status. Results are paginated in groups of 25 and cover all retained moderation records, including records beyond the 200-command moderation-history view. Servers without a cluster remain separate entries.

An exact-ID search returns matching records from your workspace and **other opted-in workspaces on the same Rookrift installation**. There is no external ban-database integration, global identifier browser, fuzzy name search, automatic cross-cluster banning, or automatic punishment based on other communities’ reports. A hosted demo uses fictional reports and browser-local settings only.

## Identifiers and scope

Choose Auto-detect, EOSID, UUID, Steam64, or Game ID. Auto-detect recognises dashed UUIDs, treats 32 hexadecimal digits as EOSID, and recognises 17-digit Steam64 IDs. Other safe opaque identifiers use Game ID. Select UUID explicitly for a compact 32-digit UUID. UUID matching ignores case and dash formatting, while common 32-hex EOS tokens match irrespective of letter case. Other opaque tokens remain case-sensitive. UUID, EOSID, Steam64, and Game ID namespaces are never joined.

Game scope can be ASA, ASE, or both. Each report retains its game; results across games are not a claim that two identifiers belong to the same person. EOS Product User IDs are product-scoped. Copy the identifier reported by the relevant game/host and select its actual type. This tool does not resolve Epic Account IDs into Product User IDs or link a person’s platform accounts.

UUID formatting follows [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html). Epic explains the per-product identifier in its [Connect login guide](https://dev.epicgames.com/docs/epic-online-services/eos-fundamentals/connect-interface/connect-guide/log-in-with-an-epic-games-account).

Moderation uses the same identity normalization to prevent duplicate active bans for case/dash variants. RCON commands still receive the original server-reported identifier, rather than a reformatted search string. Unban uses the identifier stored with the original ban and its saved ID type.

## Community sharing

Sharing is **off by default**. Expand **Community sharing**, choose a public community name, enable the checkbox, and save. This publishes existing and future tracked active bans to exact-ID queries from authenticated owners, not just bans created after enabling. Owners can search participating sources with their own sharing disabled.

Shared results contain only the matched identifier/type, public community name, cluster label, game, active/withdrawn state, first/last timestamps, and aggregate server counts. Named cluster labels become visible when sharing is enabled; choose suitable public labels. Unclustered servers use a generic public label. Player names, internal moderation reasons, staff names, workspace IDs, server IDs/names, addresses, and credentials are excluded from shared responses. Internal reasons remain in the owning workspace’s moderation history.

Accepted unban commands withdraw the corresponding server reports. A grouped cluster stays active while any server in that group still has an active tracked ban. Enable **Include withdrawn reports** to see historical withdrawals. A later ban reactivates the server report. Disabling sharing immediately hides that workspace’s records from subsequent community queries, while keeping private history. Previously viewed results are snapshots and show their check time; use Refresh lookup for current visibility. Removing a server deletes its linked directory reports.

## What the evidence means

An active report records a ban command acknowledged to Rookrift. It is not an independently verified game state, a complete imported game ban list, or a finding about someone’s conduct. Withdrawn indicates Rookrift recorded an acknowledged unban. Bans/unbans performed outside Rookrift are not automatically reconciled. A failed or explicitly rejected command does not create a new report. No match only means no matching visible records for the chosen type, game, and status.

Lookup is read-only with respect to game servers. It does not contact RCON, import bans, merge identities, or change moderation state. Moderation decisions remain with the server’s administrators.

## API and operation

- `GET /api/ban-directory/bans?status=active&game=all&page=1`: private owner-scoped directory; status accepts active/withdrawn/all, game accepts all/asa/ase.
- `POST /api/ban-directory/search`: exact lookup body `{identifier, identity_kind, game, include_withdrawn, page}`. Optional fields default to auto/all/false/1. Limited to 30 requests per authenticated user per minute.
- `PATCH /api/ban-directory/preferences`: `{sharing_enabled, public_name}` for the authenticated owner’s workspace. Public names must be 2–60 characters.

All routes require a session. Mutations and lookup POSTs require the existing same-origin/CSRF checks. Request schemas reject workspace overrides and unrecognised properties. Directory responses use `Cache-Control: no-store`. Search identifiers are sent in the POST body, never the URL. Application request errors log the route without the identifier/body; configure reverse proxies not to record request bodies.

Before upgrade, stop the single app process and take a consistent database/WAL backup plus the encryption-key backup. Schema version 3 adds sharing preferences, typed moderation keys, and the shared-report table/indexes. Existing sharing defaults to disabled. Migration retains historical command rows and private reasons, infers legacy ID types using the documented auto-detect rules, and consolidates duplicate active case/dash variants into the most recent active row. All duplicates remain in command history. Compact UUIDs cannot be inferred from legacy untyped 32-hex values; review those records against the actual game-reported ID type before opting into sharing. Do not run mixed application versions against the same database.

The directory is stored in this installation’s PostgreSQL database and uses its existing backups/access controls. It is designed for the documented single-process deployment. No public or third-party ban feed is configured.
