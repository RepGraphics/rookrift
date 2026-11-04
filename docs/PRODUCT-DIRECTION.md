# Rookrift product direction

Updated 4 November 2026. Product reference: GameServerApp. Aim: an affordable ARK-first management service that covers a community owner's daily work in one dashboard and Discord bot. Build an independent Rookrift experience around those workflows.

This is a researched product and pricing proposal. It distinguishes working features from future work. The application's current defaults remain Scout: 1 free server; Tribe: £9/month for 5 servers; Cluster: £24/month for 20 servers. This document does not change entitlements, Stripe products, subscriptions, or the hosted demo.

## What to learn from GameServerApp

GSA combines player administration, server lifecycle management, task automation, community websites/Discord integrations, monetization, and team permissions. Its value is reducing the number of tools an owner needs. Rookrift should make connecting a server, diagnosing problems, delegating work, and running repeated tasks straightforward. [GSA features](https://www.gameserverapp.com/pricing/)

GSA distinguishes RconConnect from DediConnect. Its documentation says RconConnect cannot start, stop, or update a game process; DediConnect provides deeper machine management. Rookrift needs the same clarity about connection capabilities: RCON for monitoring and supported commands, a verified host-panel connector for process controls/backups, and eventually an optional agent for installations, updates, configs, and mods. [GSA RconConnect guide](https://docs.gameserverapp.com/getting_started/rconconnect/getting_started/)

## Current position and feature gaps

| Owner's job | Working in Rookrift | Next useful addition |
| --- | --- | --- |
| Monitor a cluster | RCON snapshots, player counts, health history, incidents, Discord alerts | Persistent player sessions, reliable join/leave events, public service status |
| Moderate players | Kick/ban/unban history, private reasons, unified cluster list, opt-in exact-ID community ban lookup | Persistent player profiles, private staff notes, appeal tracking, imported ban-list reconciliation |
| Share administration | Owner dashboard; permission-gated Discord commands | Dashboard invitations, owner/admin/moderator/viewer roles, per-server permissions, actor audit |
| Run routine work | Interval saves/broadcasts, announcement templates, weekly maintenance windows, run history | Local-time task schedules, event triggers, sequential actions, restart countdowns, cooldowns and failure recovery |
| Control the host | Verified Pterodactyl process controls, resources and backup creation/status | Scheduled provider backups, completion alerts, verified restore workflow, additional host adapters |
| Maintain game content | Separate ASE/ASA adapters | Versioned INI templates, previewed config changes, mod/update detection, optional host agent |
| Serve the community | Discord bot and dashboard | Public cluster page, rules, whitelist applications, staff review, two-way chat where supported |
| Fund the community | Stripe billing for the owner's Rookrift subscription | Separate player-facing supporter store, subscriptions, fulfillment jobs, role/perk expiry, refunds and delivery history |
| Add another game | DayZ placeholder, disabled | Tested BattlEye transport and game capability matrix after the ARK workflows are proven |

GSA references: [player tools](https://www.gameserverapp.com/feature/admin-tools), [team permissions](https://www.gameserverapp.com/feature/team-collaboration), [task automation](https://www.gameserverapp.com/feature/automations-tasks), [server management](https://www.gameserverapp.com/feature/game-server-manager), [community tools](https://www.gameserverapp.com/feature/community-tools), [monetization](https://www.gameserverapp.com/feature/monetization). These describe GSA's advertised capabilities; they are not claims that every feature works with every game or provider.

## Affordability proposal

The current £9/£24 defaults are not enough to substantiate a cheaper-than-GSA claim. GSA already offers two free RconConnect servers. Its embedded monthly configurator currently shows a €5.99 base with five RconConnect servers, one admin team member, and four actions per task; ten RCON servers add €2.99, while thirty add €9.99. These are the displayed configuration amounts, not a verified final tax-inclusive checkout quote. Different currencies and selected add-ons prevent a universal percentage-saving claim. Recheck at launch. [GSA pricing](https://www.gameserverapp.com/pricing/), [embedded configurator](https://api.gameserverapp.com/api/v1/public-gui/add-ons?bgcolor=232734&custom=1&non-custom=1)

Test this simpler Rookrift launch offer with pilot owners:

| Proposed plan | Monthly GBP price | Connected game servers | Included scheduled tasks | History |
| --- | ---: | ---: | ---: | ---: |
| Scout | Free | 2 | 2 | 2 days |
| Tribe | £3.99 | 5 | 10 | 7 days |
| Cluster | £9.99 | 20 | 50 | 30 days |

These are proposed targets, not implemented plan changes or a margin guarantee. Include both ARK games, Discord controls, moderation, incident alerts, and ban lookup in every plan. Once dashboard roles exist, bundle a small useful staff allowance into paid tiers rather than making owners buy several add-ons to operate a cluster. Paid prices should reflect the actual checkout tax treatment. Game hosting and provider backup storage remain separate costs.

Avoid an early lifetime offer or unlimited servers. Measure the cost per connected server, database retention, payment fees, support time, and free-tier usage before committing to these prices. Evaluate each plan's contribution after costs; revise bundles if operating/support cost exceeds the available margin. Do not use Rookrift's own subscription-billing integration as a shortcut for collecting payments on behalf of communities: the supporter store needs a separate payment and fulfillment design.

## Delivery order

### 1. Make shared administration useful

Ship persistent player profiles and dashboard team access first. An owner should invite a moderator, restrict them to a cluster, and review who kicked or banned an identifier. A viewer must be unable to mutate state through either UI or API. Membership revocation must take effect for existing sessions. Player notes belong only to their workspace; community ban lookup continues to share only its explicit report fields.

Keep observed sessions honest: RCON polling can record approximate first/last sightings and observed presence, not exact playtime or continuous join/leave events. Retain separate typed identifiers and game scope. Do not infer identity links from names or coincidentally matching tokens.

### 2. Reduce repetitive work

Add timezone-aware task schedules and a bounded sequence of actions: announce, wait, save, request provider restart, verify recovery, notify staff. Represent each step's outcome, stop on failures, limit retries, prevent overlapping runs, and suppress crash-recovery loops during maintenance. Event-triggered workflows need verified event sources, cooldowns, and deduplication. A restart should use an available host connector rather than assuming RCON can start a stopped process.

### 3. Improve backups and configuration

Add scheduled provider backups with completion/failure notifications and explicit retention/cost settings. Restore needs an identifiable completed archive, exact target confirmation, and a recovery check. Then introduce configuration templates with a change preview, rollback, and a supported file/agent capability. Validate ASE and ASA separately. Extend host adapters based on pilot demand.

### 4. Add the player-facing community layer

Create a public cluster/status page, rules, applications and staff review. Next, design the supporter store: connected merchant accounts, order/payment reconciliation, idempotent queued delivery, offline-player handling, refund/revocation logic, and a visible delivery audit. In-game delivery and chat need tested game/plugin capabilities; unavailable actions should not be offered as working controls. Keep this distinct from the owner's platform subscription.

### 5. Broaden only after ARK retention improves

Add the host agent and mod lifecycle where customer demand supports their maintenance cost. Ship DayZ through a tested BattlEye adapter, with its own capability checks and pilot communities. Expand beyond the current single-process SQLite deployment before promising multi-worker scale.

## Measure the outcome

Start with a small real ASE/ASA pilot cohort. Track time to connect a server, successful scheduled jobs, weekly active communities, support minutes per workspace, paid conversion, and cancellations. Ask which recurring admin job each addition removes. Validate a real willingness to pay at the proposed prices before buying acquisition traffic. Use [the launch plan](LAUNCH.md) for the existing integration and deployment milestones.
