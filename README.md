# Rookrift

**Your servers. Under control.** A subscription-based ARK server management dashboard and Discord bot, built for communities running **ARK: Survival Evolved**, **ARK: Survival Ascended**, or both. DayZ has an explicit adapter placeholder and is disabled until its BattlEye integration exists.

This is a runnable MVP starter, with working backend integrations that require your credentials. The hosted Site is an **interactive, browser-local demo**, separate from the live backend. It does not connect to real servers, run a Discord bot, or collect payments. A real service needs a continuously running Node host with outbound TCP access; a static website or Cloudflare Worker cannot run this process.

Production storage uses **PostgreSQL 18**, with optional **Redis 8** chart caching. For your deployment, follow the [Dokploy setup and SQLite migration guide](docs/DOKPLOY.md). Existing SQLite data needs an explicit import with its original encryption key before starting the new backend.

The product direction is an affordable ARK-first service covering daily player administration, automation, hosting, team access and community tools. Release **0.17.0** adds [game-specific shop identities and a redesigned platform admin area](docs/ADMIN-AND-GAME-IDENTITIES.md). Version 0.16 adds [reload-safe navigation, package bundles, draft duplication and Discord shopping commands](docs/NAVIGATION-AND-PACKAGES.md). Version 0.15 adds [store promotions and growth tools](docs/STORE-GROWTH.md): coupons/scheduled sales, stock and per-account limits, checkout recovery, sales analytics/CSV and optional monthly funding goals. Version 0.14 simplifies [navigation and account management](docs/ACCOUNT-EXPERIENCE.md): grouped dashboard navigation, category-based platform settings, one community game-linking flow, shared profile/security controls, community nicknames and on-site logout. Version 0.13.2 fixes [Discord workspace settings](docs/DISCORD-CONNECTION.md), including local-account authorization, root configuration, ID handling and clear save errors. Version 0.13.1 displays account pictures throughout the dashboard, team, admin and signed-in community views, adds immediate upload previews and fixes Discord-picture rendering. See [account profiles](docs/ACCOUNT-PROFILES.md). Version 0.13 improved registration/recovery screens, adds two-step authenticator sign-in and live encrypted SMTP administration with queued reset and Stripe sales emails. See [email and authentication](docs/EMAIL-AND-AUTHENTICATION.md). Version 0.12 added public Terms, Refund and Privacy pages plus verified account deletion after membership cancellation. Read the [legal and deletion guide](docs/LEGAL-AND-ACCOUNT-DELETION.md) for operator details, the draft-policy notice and retained records. Version 0.11 added community branding, colour themes and in-game account linking; version 0.10 introduced separate game-focused workspaces, image/category catalogs and durable purchase commands/Discord rewards. It builds on the community site editor, independent join/staff applications, Stripe Connect storefront, Nitrado/Pelican connectors, local accounts/platform administration, workflows and versioned INI deployment. Read the [workspace guide](docs/WORKSPACES.md), [community guide](docs/COMMUNITY.md), [storefront setup](docs/STOREFRONT.md), [provider matrix](docs/HOSTING-PROVIDERS.md), and [remaining gaps](docs/PRODUCT-DIRECTION.md).

## Try the dashboard

Requires Node.js 24+.

```powershell
git clone https://github.com/RepGraphics/rookrift.git
cd rookrift
npm ci
npm run dev
```

Open the printed address, normally http://127.0.0.1:5173, for the public landing page, then choose **Explore the demo** for the sample dashboard. Demo changes persist in your browser. Try adding a sample server, saving a world, creating an automation, or previewing a different plan. Demo passwords are discarded. The sign-out icon in the sidebar resets the sample workspace after confirmation.

The homepage is `/`, sign-in is `/login`, registration is `/register`, and the authenticated workspace is `/dashboard`. Legal pages are public at `/terms`, `/refund-policy` and `/privacy-policy`. Public community pages remain at `/c/your-community` and platform administration remains at `/admin`. Pricing selections continue through registration to the dashboard's billing view; selecting a plan does not automatically charge it. The hosted preview clearly labels its disabled account forms and provides a demo dashboard link.

## Included

- Public marketing homepage with product illustrations, keyboard-accessible feature tabs, current plan pricing, FAQs, mobile navigation and dedicated account entry routes. Dashboard code loads separately from the public page.
- Responsive React dashboard with readable server cards, player history, RCON availability, activity filters, server search, and settings. Neutral light mode and a muted dark mode share a persistent appearance toggle in the header.
- Up to ten owned workspaces with separate servers, public community pages, teams, stores and subscriptions. Choose mixed ARK, Ascended, Evolved or DayZ planning focus; DayZ connections remain unavailable.
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
- Persistent typed player profiles with first/last sightings, observed-server history, search/presence filters, and private server-scoped staff notes.
- Discord-bound team invitations, owner/admin/moderator/viewer roles, per-server access, session workspace switching, staff audit, and immediate enforcement of changed/revoked grants on subsequent API requests.
- Explicit platform-root administration is separate from workspace ownership: platform roots can inspect users and workspaces, edit workspace/billing/Discord/community settings, revoke sessions, suspend accounts, and enter reversible support views.
- Players ? Ban lookup: a private unified cluster ban list and exact UUID/EOSID/Steam64/game-ID lookup across opt-in communities, with game scope, withdrawn reports, pagination, and private reasons excluded from sharing. See [the ban directory guide](docs/BAN-DIRECTORY.md).
- Pterodactyl and Pelican connections for process resources, power, backups and configuration; Nitrado service connections for state and power, with backend capability checks.
- Independent Join Requests and Staff Applications, separate questions/review queues, and public menu visibility tied to each toggle.
- Community site editor with four themes, up to six pages, reordered text/images/callouts/live server/news/event sections, private drafts and explicit publication.
- Stripe Connect stores with HTTPS product images, categories, display/name/date/price sorting, verified payments and immutable order snapshots. Owner-configured purchase actions run ordered server commands and Discord role awards, with durable progress, retryable preflight failures and manual review for uncertain game commands.
- Internal server notes and configurable consecutive-failure thresholds for outage incidents.
- Email/password account creation and sign-in plus Discord OAuth, with state validation and secure, revocable sessions.
- Account deletion with live cancellation checks across owned workspaces, fresh identity verification, authenticator enforcement, explicit confirmation, session revocation and limited financial-record retention. Public legal-policy drafts identify Euphoria Development and the support email; complete operator information and review before commercial launch.
- Personal account settings at `/dashboard` → **My account**: profile image/name/username, email and password changes, password reset email, Discord linking, authenticator-app 2FA, passkeys, and owner subscription invoice history. Configure **Admin ? Global settings ? Email & SMTP** (or `SMTP_*` defaults) for queued password-reset emails and optional Stripe sales/payment confirmations.
- Discord slash commands with autocomplete, guild-only execution, Manage Server checks, workspace ownership, and private responses.
- Stripe Checkout, customer portal, verified/idempotent webhooks, current-state reconciliation, and server-side entitlements.
- Pooled asynchronous PostgreSQL persistence, transactional quota checks, batched player snapshots, optional Redis chart caching with database fallback, and a read-only SQLite importer.
- Encrypted RCON and Discord tokens, CSRF protection, rate limits, input validation, and private-network target protection.
- Docker deployment and reverse-proxy example.
- Generated logo, PNG/ICO favicons, touch icon, landscape art, and locally hosted fonts.

## Launch plan defaults

These are product defaults, not validated market pricing. Prices are in GBP per workspace per month. Your configured Stripe products must match the prices displayed here, including your chosen tax treatment.

| Plan | Monthly price | Game servers | Automations | Additional staff | Activity / metric retention |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scout | Free | 2 | 2 | 0 | 2 days |
| Tribe | £3.99 | 5 | 10 | 3 | 7 days |
| Cluster | £9.99 | 20 | 50 | 10 | 30 days |

All plans include both ARK adapters, monitoring, manual saves/broadcasts, and Discord commands. Hosting for the actual game servers is separate. Paid limits apply only while Stripe reports `active` or `trialing`. Other statuses use Scout limits. A downgrade keeps saved records, enables the oldest servers up to the new limit, and pauses extra connections and automations. No servers are destroyed.

## Enable the real service

### 1. Configure the environment

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the generated value into `ENCRYPTION_KEY` in `.env`. Keep it stable and back it up separately from the database; changing it makes existing encrypted passwords unreadable. Never commit `.env` or paste credentials into chat.

Set `APP_URL` to your exact origin. For an initial local live build use `http://localhost:3000`, `NODE_ENV=development`, and the matching Discord redirect URI. For production use your HTTPS origin and `NODE_ENV=production`.

Set `DATABASE_URL` to your PostgreSQL connection URL. In Dokploy, use its internal PostgreSQL URL; `REDIS_URL` optionally enables Redis. For the bundled Compose stack, fill in `POSTGRES_PASSWORD` and `REDIS_PASSWORD` and leave `DATABASE_URL` empty to use its internal database service. The [Dokploy guide](docs/DOKPLOY.md) covers both approaches and local backend development.

### 2. Create your Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create the Rookrift application and bot. Upload the included square logo as its avatar.
2. Copy the application ID, client secret, and bot token into the corresponding `.env` fields.
3. Add the exact OAuth redirect URI: `APP_URL/auth/discord/callback`. Set `DISCORD_REDIRECT_URI` to that same full URL.
4. Enable server installation with `bot` and `applications.commands`. The bot uses only the Guilds intent; privileged member and message-content intents are unnecessary.
5. Run `npm run bot:register`. Set `DISCORD_DEV_GUILD_ID` first for immediate testing in a development guild; omit it for global registration.
6. Create an account or sign in on the live dashboard (Discord OAuth is also available), use **Discord bot → Add Rookrift**, then link a Discord server you manage in **Settings**. An alert channel is optional. The bot needs View Channel, Send Messages, and Embed Links there.

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

Create recurring monthly GBP prices for Tribe (£3.99 / 399 pence) and Cluster (£9.99 / 999 pence). Put their price IDs and your test secret key into `.env`. Checkout rejects a configured price that differs from the displayed amount, currency, or one-month interval. Configure the Stripe customer portal to allow the desired upgrades, downgrades, cancellations, and invoice access. Restrict it to these products/prices and your monthly billing policy. Existing subscriptions are not repriced automatically; retain older entitled price IDs in the optional legacy environment settings when replacing the checkout prices. See [the migration guide](docs/TEAM-AND-PLAYERS.md).

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

For the Docker development stack, set `STRIPE_CLI_API_KEY` in `.env`, then start the
two forwarding services with `docker compose --profile stripe up -d`. The
`stripe-cli` service forwards subscription events to `/api/webhooks/stripe`, while
`stripe-connect-cli` forwards connected-account store events to
`/api/webhooks/community-stripe`. Copy each listener's `whsec_...` value from
`docker compose --profile stripe logs stripe-cli` and
`docker compose --profile stripe logs stripe-connect-cli` into
`STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`, respectively, then
restart `rookrift`. Use Stripe test-mode secret keys and test price IDs locally.
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

Use a continuously running Node/container host with outbound TCP and access to PostgreSQL. Dokploy can manage PostgreSQL and Redis as separate services; follow [DOKPLOY.md](docs/DOKPLOY.md). Use one application replica and stop-first deployments because the scheduler, Discord gateway and command locks remain in that runtime. A PostgreSQL advisory lease rejects duplicate active runtimes.

1. Set the HTTPS `APP_URL`, matching Discord redirect, all required keys, and `TRUST_PROXY_HOPS=1` if exactly one trusted reverse proxy sits in front of the app.
2. Run `docker compose up -d --build`.
3. Route your domain through an HTTPS reverse proxy to `127.0.0.1:3000`; see [Caddyfile.example](docs/Caddyfile.example).
4. Run command registration from the configured environment, or `docker compose exec rookrift node server/register-commands.js`.
5. Configure PostgreSQL backups and keep the encryption key separately. Verify restoration before launch. When migrating from SQLite, stop the old app and follow the explicit importer steps in the Dokploy guide.

The standalone Compose stack binds the application port to host loopback and keeps both databases off public host ports. Secrets are injected through environment variables, never baked into the image. `GET /api/health` reports HTTP liveness; `/api/ready` checks PostgreSQL and reports optional cache status. Redis failure alone does not fail readiness. Neither endpoint verifies every external integration.

PostgreSQL is now the primary store. Multi-replica application workers still need a separate queue/worker design and a deliberate Discord gateway strategy. Redis currently caches disposable aggregates and does not provide distributed job execution.

## Verification

```text
npm test
npm run build
npm run build:demo
npm run test:docker
```

The backend tests run against real PostgreSQL and Redis services. `npm run test:unit` starts temporary Docker fixtures automatically, or uses `TEST_DATABASE_URL` and `TEST_REDIS_URL`. Each fixture uses its own PostgreSQL schema. Coverage includes workflow sequencing/interruption/cancellation, webhook deduplication, restart evidence, INI patch privacy/deployment/rollback, community privacy/permissions, application and RSVP concurrency, calendar DST behavior, PostgreSQL upgrades, transaction rollback/isolation, quotas, runtime leases, SQLite import preservation/rollback, Redis expiry/failure fallback, and existing team, billing, RCON and operations behavior. The dashboard, workspaces, catalog, purchase actions, workflows, configuration and community hub have interaction tests. `node scripts/check-contrast.mjs` verifies 15 text/background colour pairs per theme against a minimum 4.5:1 ratio. Discord, Stripe and game-provider calls use fixtures and still need real integration testing.

Browser screenshot QA remains unavailable because the browser access host is unavailable. Desktop/mobile layout needs a visual review before public launch. The Docker image is built and smoke-tested with authenticated API checks; external Discord, Stripe and game-provider behavior still requires live integration testing.

## Scope and next steps

Process controls use a supported host connector; backups and configuration depend on its capabilities. A native host agent, world-backup restoration, mod installation, inventory-verifying delivery plugins, recurring supporter subscriptions, perk expiry/revocation and DayZ remain future work. Configured purchase commands need testing against the actual game/plugin and player identifier. RCON acknowledgment is not independent proof that items reached the inventory. RCON SaveWorld is separate from provider file backups.

Simple automations support intervals and timezone-aware weekly schedules; workflows add bounded multi-step sequences. They are claimed before running, run at most once per claim, and skip missed intervals after downtime. Monitoring is sequential per minute cycle, so large or unreachable fleets take longer. Events older than the plan retention period are pruned by the background process. Demo data is browser-local and persists until reset.

See [OPERATIONS.md](docs/OPERATIONS.md) for v0.3 reliability, moderation, hosting setup and upgrade instructions; [FEATURES.md](docs/FEATURES.md) for fleet basics; [LAUNCH.md](docs/LAUNCH.md) for a route to a paid pilot; and [ARCHITECTURE.md](docs/ARCHITECTURE.md) for system details.
## In-game account linking

Members open **Game accounts** on a public community page, select their world and generate a ten-minute, server-bound code. Rookrift reads native ARK global chat through RCON independently of hosting consoles, verifies a unique sender against fresh player data, and consumes codes atomically. Trusted server extensions can submit controller-derived IDs; raw log text only prompts a native chat check. See [account linking and diagnostics](docs/ACCOUNT-LINKING.md).

Customise community branding under **Community page** and open **Site editor > Brand & appearance** for themes, accents, banner images, layout, fonts, navigation and footer controls. Publish the design to apply it publicly. See [community setup](docs/COMMUNITY.md).
