# Rookrift product direction

Updated 6 November 2026. Product references: GameServerApp and Tebex. Aim: an affordable multi-game management service that covers a community owner's daily work in one dashboard and Discord bot. Build an independent Rookrift experience around those workflows.

Version 0.20 adds [Minecraft Java/DayZ beta connections and online-recipient delivery](MULTIGAME-AND-DELIVERY.md). Version 0.19 adds [workspace support summaries and ownership navigation](PLATFORM-SUPPORT.md). Version 0.18 adds [focused admin tasks and password recovery](ADMIN-PASSWORD-RECOVERY.md), including SMTP reset emails and expiring generated credentials with a required password-change step. Version 0.17 adds [game-specific shop identity validation, focused admin directories and a restricted platform activity log](ADMIN-AND-GAME-IDENTITIES.md). Version 0.16 adds [saved page/tab URLs, package bundles, draft duplication and private Discord shopping](NAVIGATION-AND-PACKAGES.md). Version 0.15 adds [coupons, sales, purchase limits, reporting and funding goals](STORE-GROWTH.md), with transactional reservations and checkout recovery. Version 0.14 consolidates [member accounts and settings](ACCOUNT-EXPERIENCE.md), adds community profile management/logout and splits platform settings by integration. Version 0.13 adds refreshed account/recovery screens, a separate authenticator sign-in step and [SMTP administration/transactional emails](EMAIL-AND-AUTHENTICATION.md). Version 0.12 added public legal-policy drafts and cancellation-gated account deletion with fresh identity verification, checkout fencing and limited transaction retention. See [legal and account deletion](LEGAL-AND-ACCOUNT-DELETION.md) for launch requirements and policy choices. Version 0.11 added community branding, six colour themes/custom accents, expanded appearance controls, navigation alignment and [in-game account linking](ACCOUNT-LINKING.md). Version 0.10 introduced [multiple workspaces](WORKSPACES.md), image/category catalogs, wider sorting and ordered server-command/Discord-role purchase actions in the [Stripe Connect storefront](STOREFRONT.md). It builds on separate Join Requests and Staff Applications, a [multi-page site editor](COMMUNITY.md), [Nitrado/Pelican connectors](HOSTING-PROVIDERS.md), local accounts/platform administration, workflows, configuration deployment, scoped teams, PostgreSQL and Redis. Scout remains free, Tribe GBP 3.99/month and Cluster GBP 9.99/month per workspace. Store catalog allowances are 5/25/100 products; workflows retain 2/10/50 allowances. Merchant payments remain separate from Rookrift subscription billing.

## What to learn from GameServerApp

GSA combines player administration, server lifecycle management, task automation, community websites/Discord integrations, monetization, and team permissions. Its value is reducing the number of tools an owner needs. Rookrift should make connecting a server, diagnosing problems, delegating work, and running repeated tasks straightforward. [GSA features](https://www.gameserverapp.com/pricing/)

GSA distinguishes RconConnect from DediConnect. Its documentation says RconConnect cannot start, stop, or update a game process; DediConnect provides deeper machine management. Rookrift needs the same clarity about connection capabilities: RCON for monitoring and supported commands, a verified host-panel connector for process controls/backups, and eventually an optional agent for installations, updates, configs, and mods. [GSA RconConnect guide](https://docs.gameserverapp.com/getting_started/rconconnect/getting_started/)

## Current position and feature gaps

| Owner's job | Working in Rookrift | Next useful addition |
| --- | --- | --- |
| Monitor a cluster | RCON snapshots, player counts, health history, incidents, Discord alerts, opt-in public server status | Persistent player sessions and reliable join/leave events |
| Moderate players | Kick/ban/unban history, profiles and private server-scoped staff notes, unified cluster list, opt-in exact-ID community ban lookup | Appeal tracking and imported ban-list reconciliation |
| Share administration | Multiple isolated workspaces with game focus, separate subscriptions/public pages, Discord-bound invitations, dashboard roles/server scopes and staff audit | Further game integrations for shared administration |
| Run routine work | Simple schedules plus persistent multi-step workflows, local calendar/incident/webhook triggers, restart countdowns, cooldowns, cancellation and step history | Verified in-game events, achievements, richer conditions and additional game actions |
| Control the host | Pterodactyl/Pelican process controls/resources, manual/scheduled backups and config deployment; Nitrado state/power controls | Verified game-world restore workflow, retention policies, additional host adapters |
| Maintain game content | Separate ASE/ASA adapters, versioned INI patches, change previews, stopped-server file deployment and encrypted guarded rollback | Full array/config schema support, mod/update detection and installation, optional host agent |
| Serve the community | Branded multi-page site editor, colour/layout controls, draft publishing, native ARK account linking, rules/news/events/RSVPs and separate join/staff forms | Verified whitelist execution, forums, two-way chat where supported |
| Fund the community | Stripe Connect one-time storefront, product images/categories, searchable catalog/orders, verified checkout, snapshotted server commands and Discord role grants, staff delivery, coupons/sales, stock/customer limits, analytics/goals and refund/dispute review | Tested inventory-verifying plugins, recurring supporter subscriptions, role/perk expiry and automatic revocations |
| Add another game | Minecraft Java Source RCON and DayZ BattlEye UDP beta adapters, native identity namespaces, game-specific controls/catalogs/workspaces | Live pilot validation, plugin-specific parsers and verified account/fulfillment integrations |

GSA references: [player tools](https://www.gameserverapp.com/feature/admin-tools), [team permissions](https://www.gameserverapp.com/feature/team-collaboration), [task automation](https://www.gameserverapp.com/feature/automations-tasks), [server management](https://www.gameserverapp.com/feature/game-server-manager), [community tools](https://www.gameserverapp.com/feature/community-tools), [monetization](https://www.gameserverapp.com/feature/monetization). These describe GSA's advertised capabilities; they are not claims that every feature works with every game or provider.

## What to learn from Tebex

Release 0.20 adds an explicit online-recipient preflight around Rookrift's durable purchase queue. This follows Tebex's online-player command delivery and GSA's visible pending deliveries. Existing orders retain immutable actions, target validation, execution history and manual handling of uncertain commands. The [multi-game delivery guide](MULTIGAME-AND-DELIVERY.md) records the implementation and limits, with primary documentation links.

Next prioritize recurring supporter packages with purchase/renewal/expiry/refund actions, then package prerequisites and cumulative upgrades, followed by inventory-confirming plugins. Recurring perks require ownership tracking so expiry cannot revoke a role or benefit another active entitlement still grants. These features remain planned; a platform subscription does not implement a community's supporter subscription. Rookrift currently provides a connected-merchant storefront.

## Affordability proposal

The previous £9/£24 defaults did not substantiate a cheaper-than-GSA claim. GSA already offers two free RconConnect servers. Its embedded monthly configurator was checked on 4 November 2026 and showed a €5.99 base with five RconConnect servers, one admin team member, and four actions per task; ten RCON servers added €2.99, while thirty added €9.99. These are displayed configuration amounts, not a verified final tax-inclusive checkout quote. Different currencies and selected add-ons prevent a universal percentage-saving claim. Recheck at launch. [GSA pricing](https://www.gameserverapp.com/pricing/), [embedded configurator](https://api.gameserverapp.com/api/v1/public-gui/add-ons?bgcolor=232734&custom=1&non-custom=1)

Version 0.5 applies these app defaults; validate the offer with pilot owners:

| Current plan | Monthly GBP price | Connected game servers | Included scheduled tasks | History |
| --- | ---: | ---: | ---: | ---: |
| Scout | Free | 2 | 2 | 2 days |
| Tribe | £3.99 | 5 | 10 | 7 days |
| Cluster | £9.99 | 20 | 50 | 30 days |

These defaults are implemented but are not a margin guarantee. Available game adapters, Discord controls, supported moderation, incident alerts and ban lookup remain in every plan. Team allowances are bundled into paid tiers: 3 staff seats for Tribe and 10 for Cluster. Game hosting and provider backup storage remain separate costs.

Avoid an early lifetime offer or unlimited servers. Measure the cost per connected server, database retention, payment fees, support time, and free-tier usage before committing to these prices. Evaluate each plan's contribution after costs; revise bundles if operating/support cost exceeds the available margin. Do not use Rookrift's own subscription-billing integration as a shortcut for collecting payments on behalf of communities: the supporter store needs a separate payment and fulfillment design.

## Delivery order

### 1. Make shared administration useful ? implemented in 0.5

Version 0.5 ships persistent player profiles and dashboard team access. An owner should invite a moderator, restrict them to a cluster, and review who kicked or banned an identifier. A viewer must be unable to mutate state through either UI or API. Membership revocation must take effect for existing sessions. Player notes belong only to their workspace; community ban lookup continues to share only its explicit report fields.

Keep observed sessions honest: RCON polling can record approximate first/last sightings and observed presence, not exact playtime or continuous join/leave events. Retain separate typed identifiers and game scope. Do not infer identity links from names or coincidentally matching tokens.

### 2. Reduce repetitive work

Version 0.8 implements bounded sequences, restart countdowns, archive/recovery verification, incident/webhook triggers, cooldowns, deduplication and explicit cancellation. It persists waits and stops ambiguous external actions instead of replaying them. Next add game/plugin event sources and achievement conditions once their identity and delivery guarantees are tested. Process restarts use the verified host connector.

### 3. Improve backups and configuration

Version 0.8 adds exact backup-completion verification with notifications in archive workflows, and versioned configuration patches with live previews, stopped-server Pterodactyl file writes and encrypted guarded rollback. Remaining work includes world-backup restore, explicit provider retention/cost policies, complex array settings and deeper mod/agent support. Validate live panel paths, permissions and game semantics on pilot servers.

### 4. Add the player-facing community layer

Version 0.7 ships a public cluster/status hub, rules/news, events with RSVPs, join/staff applications and staff review. Version 0.9 adds connected merchant accounts and payment reconciliation. Version 0.10 adds product categories/images and durable purchase actions, including owner-configured RCON commands and Discord role grants. Unsent commands wait for an available server and can optionally require a fresh native recipient-presence check; uncertain commands stop for manual review and are never replayed automatically. Next add tested inventory-verifying plugins, verified offline-player delivery and perk expiry/revocation. Game commands still require the right game/plugin and recipient type. Keep merchant purchases distinct from the owner's platform subscription.

### 5. Validate multi-game operation

Add the host agent and mod lifecycle where customer demand supports their maintenance cost. Version 0.20 implements Minecraft Java and DayZ beta adapters with native account namespaces and explicit capability checks. Validate them on live pilot servers before broad commercial use. Version 0.6 adds PostgreSQL and optional Redis metric caching; distributed jobs/gateway workers remain a separate step before multi-worker scale.

## Measure the outcome

Start with small live pilot cohorts for each supported game. Track time to connect a server, successful scheduled jobs, weekly active communities, support minutes per workspace, paid conversion, and cancellations. Ask which recurring admin job each addition removes. Validate a real willingness to pay at the proposed prices before buying acquisition traffic. Use [the launch plan](LAUNCH.md) for the existing integration and deployment milestones.
