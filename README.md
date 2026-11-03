# Rookrift

**Your servers. Under control.** A subscription-based ARK server management dashboard and Discord bot, built for communities running **ARK: Survival Evolved**, **ARK: Survival Ascended**, or both. DayZ has an explicit adapter placeholder and is disabled until its BattlEye integration exists.

This is a runnable MVP starter, with working backend integrations that require your credentials. The hosted Site is an **interactive, browser-local demo**, separate from the live backend. It does not connect to real servers, run a Discord bot, or collect payments. A real service needs a continuously running Node host with outbound TCP access; a static website or Cloudflare Worker cannot run this process.

## Try the dashboard

Requires Node.js 24+.

```powershell
cd C:\Users\rep\Downloads\Sub\rookrift
npm install
npm run dev
```

Open the printed address, normally http://127.0.0.1:5173. Demo changes persist in your browser. Try adding a sample server, saving a world, creating an automation, or previewing a different plan. Demo passwords are discarded. The sign-out icon in the sidebar resets the sample workspace after confirmation.

## Included

- Responsive React dashboard with readable server cards, player history, RCON availability, activity filters, server search, and settings. Neutral light mode and a muted dark mode share a persistent appearance toggle in the header.
- Separate per-server ASA/ASE selection; a workspace can manage both games using shared slots.
- Server groups, fleet filters/sorting, and connection editing with optional encrypted password replacement.
- Source RCON: connection checks, player lists, `SaveWorld`, and announcements.
- Confirmed bulk connection checks, world saves, and announcements with per-server success/failure results.
- A searchable cross-server player snapshot view with reported IDs and check timestamps.
- Persistent interval automations with editing, run-now controls, and latest successful/failed/skipped outcomes.
- Maintenance mode that pauses scheduled commands and connection alerts while monitoring continues.
- Workspace Discord alert preferences, searchable/server-filtered activity, and CSV export of visible events.
- Operations workspace with per-server health trends, observed availability, latency percentiles, incident acknowledgement/notes, and persistent notifications.
- Reusable announcement templates, live placeholders, timezone-aware weekly maintenance windows, and retained automation execution history.
- Player kick/ban/unban controls with server-reported identity checks, internal reasons, and a moderation audit trail.
- Players ? Ban lookup: a private unified cluster ban list and exact UUID/EOSID/Steam64/game-ID lookup across opt-in communities, with game scope, withdrawn reports, pagination, and private reasons excluded from sharing. See [the ban directory guide](docs/BAN-DIRECTORY.md).
- Verified Pterodactyl client API connections for process resources, start/stop/restart requests, and provider backup creation/status.
- Internal server notes and configurable consecutive-failure thresholds for outage incidents.
- Discord OAuth sign-in with state validation and secure, revocable sessions.
- Discord slash commands with autocomplete, guild-only execution, Manage Server checks, workspace ownership, and private responses.
- Stripe Checkout, customer portal, verified/idempotent webhooks, current-state reconciliation, and server-side entitlements.
- SQLite persistence, encrypted RCON and Discord tokens, CSRF protection, rate limits, input validation, and private-network target protection.
- Docker deployment and reverse-proxy example.
- Generated logo, PNG/ICO favicons, touch icon, landscape art, and locally hosted fonts.

## Proposed launch plans

These are product defaults, not validated market pricing. Prices are in GBP per workspace per month. Your configured Stripe products must match the prices displayed here, including your chosen tax treatment.

| Plan | Monthly price | Game servers | Automations | Activity / metric retention |
| --- | ---: | ---: | ---: | ---: |
| Scout | Free | 1 | 0 | 1 day |
| Tribe | £9 | 5 | 10 | 7 days |
| Cluster | £24 | 20 | 50 | 30 days |

All plans include both ARK adapters, monitoring, manual saves/broadcasts, and Discord commands. Hosting for the actual game servers is separate. Paid limits apply only while Stripe reports `active` or `trialing`. Other statuses use Scout limits. A downgrade keeps saved records, enables the oldest servers up to the new limit, and pauses extra connections and automations. No servers are destroyed.

## Enable the real service

### 1. Configure the environment

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the generated value into `ENCRYPTION_KEY` in `.env`. Keep it stable and back it up separately from the database; changing it makes existing encrypted passwords unreadable. Never commit `.env` or paste credentials into chat.

Set `APP_URL` to your exact origin. For an initial local live build use `http://localhost:3000`, `NODE_ENV=development`, and the matching Discord redirect URI. For production use your HTTPS origin and `NODE_ENV=production`.

### 2. Create your Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create the Rookrift application and bot. Upload the included square logo as its avatar.
2. Copy the application ID, client secret, and bot token into the corresponding `.env` fields.
3. Add the exact OAuth redirect URI: `APP_URL/auth/discord/callback`. Set `DISCORD_REDIRECT_URI` to that same full URL.
4. Enable server installation with `bot` and `applications.commands`. The bot uses only the Guilds intent; privileged member and message-content intents are unnecessary.
5. Run `npm run bot:register`. Set `DISCORD_DEV_GUILD_ID` first for immediate testing in a development guild; omit it for global registration.
6. Sign in on the live dashboard, use **Discord bot → Add Rookrift**, then link a Discord server you manage in **Settings**. An alert channel is optional. The bot needs View Channel, Send Messages, and Embed Links there.

Commands:

```text
/rookrift servers
/rookrift status server:<selection>
/rookrift players server:<selection>
/rookrift save server:<selection>
/rookrift broadcast server:<selection> message:<text>
/rookrift maintenance server:<selection> enabled:true
/rookrift dashboard
```

The bot runs in the backend process. Registration is a separate setup command. Re-register after upgrading to add the maintenance subcommand. It cannot be started from the hosted demo. Linking a community verifies your current Discord membership and Manage Server permission; expired Discord authorization requires signing in again.

### 3. Configure Stripe in test mode first

Create recurring monthly GBP prices for Tribe (£9) and Cluster (£24). Put their price IDs and your test secret key into `.env`. Configure the Stripe customer portal to allow the desired upgrades, downgrades, cancellations, and invoice access. Restrict it to these products/prices and your monthly billing policy.

Create a webhook endpoint at `APP_URL/api/webhooks/stripe`, subscribe to:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

Save the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`. For local testing use Stripe CLI forwarding:

```text
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The code uses the modern invoice `parent.subscription_details.subscription` field, with a legacy fallback. Use a webhook API version compatible with the installed Stripe SDK and test your exact account configuration. Entitlements come from the configured **price IDs and current Stripe subscription state**, never from a successful redirect or client-supplied plan. Retries are deduplicated. An active process reconciles known subscriptions about every 15 monitoring cycles, so missed webhooks can recover.

Complete an end-to-end Stripe test-mode payment, renewal failure, portal change, and cancellation before substituting live keys. This repository does not provide your merchant account, tax registration, or business policies.

### 4. Build and run in live mode

```powershell
npm run build
npm start
```

Open http://localhost:3000 for the local configuration. `npm run build` always creates the live application. **Do not deploy `build:demo` as your commercial service.** `npm run build:demo` is only for the separate hosted interactive preview.

For live frontend development, run `npm run server:dev` and `npm run dev:live` in separate terminals. Set `APP_URL=http://localhost:5173` and `DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord/callback`; visit `localhost:5173`, not `127.0.0.1`, so the origin and cookie checks match.

### 5. Connect an ARK server

Enable RCON through your hosting provider or under `[ServerSettings]` in `GameUserSettings.ini`:

```ini
[ServerSettings]
RCONEnabled=True
RCONPort=27020
ServerAdminPassword=use-a-unique-strong-password
```

Restart the game server as required by your host, allow inbound TCP to its RCON port from the Rookrift host, and add it in the dashboard. Choose the correct game, map label, server capacity, host/IP, RCON port, and password. Status starts as pending until the first background check, normally within one minute.

Map and player capacity are user-provided labels; live player counts come from `ListPlayers`. RCON availability means a successful authenticated RCON response, not independently measured game simulation health. ASA/ASE provider and platform configurations vary. Verify against your host before inviting paying customers.

Only public RCON targets are permitted by default. `ALLOW_PRIVATE_RCON=true` is an explicit operator opt-in for trusted private deployments. The entire address set is checked before connecting, and the validated IP is pinned to prevent DNS rebinding. RCON itself is unencrypted; use a firewall allowlist or private tunnel and avoid exposing it broadly.

## Production deployment

Use a VPS/container host that supports persistent disk, outbound TCP, and a continuously running process. The first deployment should be one replica because the scheduler, server command locks, and SQLite writes are managed by that process.

1. Set the HTTPS `APP_URL`, matching Discord redirect, all required keys, and `TRUST_PROXY_HOPS=1` if exactly one trusted reverse proxy sits in front of the app.
2. Run `docker compose up -d --build`.
3. Route your domain through an HTTPS reverse proxy to `127.0.0.1:3000`; see [Caddyfile.example](docs/Caddyfile.example).
4. Run command registration from the configured environment, or `docker compose exec rookrift node server/register-commands.js`.
5. Back up the persistent volume and encryption key. Verify restoration before launch. Use SQLite's online backup API or stop the app for a consistent copy of the database and WAL files.

The container binds the application port to host loopback. Secrets are injected through `.env`, never baked into the image. Health: `GET /api/health`. This reports HTTP availability only, not the health of every integration.

At larger scale, move storage to PostgreSQL, put RCON jobs behind a queue, add distributed locks and per-tenant quotas, and run multiple gateway workers with a deliberate Discord sharding strategy. Do not scale this SQLite process horizontally as-is.

## Verification

```text
npm test
npm run build
npm run build:demo
```

The suite contains 64 Node backend/protocol tests and 31 dashboard interaction tests. Coverage includes encrypted credentials, workspace isolation, CSRF, sessions, paid limits, migrations, bulk actions, recurring windows, timezone/midnight behavior, typed ban-directory lookup, opt-in sharing and opt-out visibility, shared-field filtering, withdrawal/re-ban lifecycle, pagination, legacy ban migration, moderation identity/command checks, Pterodactyl request mapping/confirmation, SSRF restrictions, announcements, incidents, notifications, health analytics, execution history, RCON TCP framing, and the existing billing/dashboard flows. `node scripts/check-contrast.mjs` verifies 15 text/background colour pairs per theme against a minimum 4.5:1 ratio. External integrations are mocked or exercised with a local protocol fixture. Tests are not proof of live provider compatibility.

Browser screenshot QA was unavailable in this environment: the browser host was unavailable, and native Firefox automation stopped because URL-policy enforcement was unsupported. Desktop/mobile layout needs a visual review before public launch. The Docker image was built and smoke-tested: health and dashboard return 200, protected API routes return 401 before sign-in, and authenticated directory lookup verifies opt-in visibility, private-field filtering, and unban withdrawal.

## Scope and next steps

Process start/stop/restart and file backup creation/status now use a connected Pterodactyl panel. Other hosts, a native host agent, backup restoration/download/deletion, mod installation, remote INI editing, cross-server chat, delegated web-dashboard team seats, and DayZ are not implemented. RCON `SaveWorld` writes the current game save; it is separate from provider file backups. Moderation records submitted commands and still requires live game/provider verification.

Automations are interval-based, not cron calendars. They are claimed before running, run at most once per claim, and skip missed intervals after downtime. Monitoring is sequential per minute cycle, so large or unreachable fleets take longer. Events older than the plan retention period are pruned by the background process. Demo data is browser-local and persists until reset.

See [OPERATIONS.md](docs/OPERATIONS.md) for v0.3 reliability, moderation, hosting setup and upgrade instructions; [FEATURES.md](docs/FEATURES.md) for fleet basics; [LAUNCH.md](docs/LAUNCH.md) for a route to a paid pilot; and [ARCHITECTURE.md](docs/ARCHITECTURE.md) for system details.
