# Multi-step workflows

Rookrift 0.8 adds persisted workflows to the dashboard and Discord bot. These implement scheduled/event-driven sequences of the kind described by [GameServerApp automations](https://www.gameserverapp.com/feature/automations-tasks), using Rookrift's own ARK and Pterodactyl adapters.

## Build and run

Open **Workflows**. Start with **Restart countdown**, **Verified archive**, **Recovery check**, or **New workflow**. Choose a server and add/reorder up to 12 steps:

- Announce in game, with `{server}`, `{map}`, `{players}` and `{cluster}` placeholders.
- Wait 5–3,600 seconds. Total explicit waits may not exceed six hours.
- Save the current world.
- Request a separate provider backup.
- Verify that the exact requested archive completed (1–120 minute timeout).
- Restart through the verified hosting connector.
- Verify authenticated RCON recovery (1–30 minute timeout).
- Notify staff in the dashboard and, when configured/available, the linked Discord alert channel.

Saving a workflow that contains a restart requires the exact server name. This authorises its automatic provider restart when the selected trigger fires. **Run now** requires the name again for restart workflows. Hosting steps require a verified Pterodactyl connection. A world save and a completed archive are separate operations.

Each run snapshots its definition and shows every step's result, wait, deadline and archive reference. Editing/deleting a workflow is blocked during an active run. Disabling a definition requests cancellation of active runs. **Cancel remaining steps** stops later actions; an external action already in progress can still complete. Concurrent workflows on the same server are refused.

## Triggers

- **Manual:** dashboard or authorised Discord command.
- **Interval:** at least 15 minutes apart; missed intervals are not replayed.
- **Local time & weekdays:** the same IANA-timezone/DST rules as simple automations.
- **Confirmed RCON outage:** an incident opened by the configured failed-check threshold.
- **RCON recovered:** a newly resolved incident observed by polling.
- **Authenticated webhook:** a saved workflow triggered by a bearer key and unique event ID.

Cooldowns apply to manual and automatic starts. Outage workflows require at least a 60-minute cooldown; across all outage workflows on a server, automatic starts are limited to one per hour and three per 24 hours. Only recent incident events after the workflow's activation are eligible. A lost RCON connection may be a network problem; it does not prove that the game process crashed. Choose automatic restarts deliberately.

Maintenance and plan limits are rechecked before every step. Entering maintenance cancels an active run. Connection changes, server removal and unrelated hosting actions are blocked while a workflow owns the server. Legacy single-action automations are recorded as skipped during the reservation. Planned provider-restart stages suppress false outage alerts; failures after the workflow ends can raise ordinary incidents again.

## Verification and interruption handling

After a provider restart, a positive RCON response alone is insufficient: the old process might still be answering. Verification requires provider evidence (a stopped/starting transition or decreased uptime), a running state, then an authenticated RCON response. If the panel cannot provide evidence, the step waits and eventually times out.

Verification probes retry every 30 seconds. A known local busy guard can defer an **unsent** action for up to five minutes. Sent save/broadcast/restart/backup commands are not automatically retried. The execution marker is committed before an external action. If Rookrift restarts while that action is marked executing, the run fails as uncertain without replaying the command. Check game/provider state before creating another run. Persisted waits can resume after a runtime restart.

The worker ticks every five seconds, processes independent servers with bounded concurrency, and keeps durable state in PostgreSQL. Redis is not a job queue. Run exactly one application replica, as required by the existing runtime lease. Run history follows the plan's 2/7/30-day retention; active runs are not pruned. Definitions are limited separately from simple automations: Scout 2, Tribe 10, Cluster 50.

## Webhooks

Choose the webhook trigger, save, then open its key button. Generate/rotate the key; it is shown once and stored only as a hash. Existing keys stop working after rotation.

```http
POST /api/hooks/workflows/WORKFLOW_ID
Authorization: Bearer YOUR_WORKFLOW_KEY
Content-Type: application/json

{"event_id":"unique-upstream-event-id"}
```

Use a unique event ID per intended run. Repeat IDs return the previous run reference for at least 30 days, even when shorter run history expires. The payload cannot select a server, modify steps or inject commands. Send credentials in the header, never a query string. Endpoint rate limits, workflow cooldowns, plan entitlement and maintenance still apply.

## Access and deployment

Owners and scoped administrators can manage/run workflows for permitted servers. Other staff can inspect definitions/history within their server scope. Webhook-key rotation follows administrator scope. No key or credential is returned by ordinary list/history endpoints.

Re-register slash commands after deployment: `/rookrift workflows`, `/rookrift workflow-run` and `/rookrift workflow-cancel`. Existing guild/Manage Server checks and private replies apply. The demo simulates steps with **Advance demo step**; its timer, archive completion and restarts are not live operations.
