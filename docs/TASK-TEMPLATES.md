# Game task templates

Release 0.23 adds a searchable template library under **Automations** and **Workflows**, available to workspace owners and staff with management access. Filter by game and category, choose a permitted server, and select **Use template** to open the normal editor. Browsing or selecting a template does not create or execute a task.

New template drafts start disabled. Review the name, announcement text, steps, local time, weekdays and timezone, then save. Enable the task when ready. Templates use the browser's timezone where available, otherwise UTC. Daily templates use the existing local-time scheduler: nonexistent daylight-saving times are skipped and repeated times use their first occurrence. Interval tasks follow elapsed time.

## Included recipes

| Game | Scheduled tasks | Workflows |
| --- | --- | --- |
| ARK Ascended / Evolved | World save every 30 minutes, daily world save, community rules/links, weekend event, daily provider backup | Five-minute restart countdown with world save, provider archive with completion check, recovery alert, daily connection check |
| Minecraft Java (beta) | World save every 15 minutes, daily world save, community rules/links, weekend event, daily provider backup | Five-minute restart countdown with world save, provider archive with completion check, recovery alert, daily connection check |
| DayZ (beta) | BattlEye survivor reminder, community rules/links, weekend event, daily provider backup | Five-minute restart countdown, provider archive with completion check, recovery alert, daily connection check |

Community links and event messages include bracketed text for the operator to replace. Supported announcement placeholders include `{server}`, `{map}`, `{players}` and `{cluster}`. Templates copy into independent editable tasks; later library changes do not overwrite saved tasks.

## Connection requirements

- Saves and announcements use the existing native game adapters. Minecraft Java does not need a plugin for these actions. DayZ announcements use BattlEye; DayZ templates never include an unsupported world-save action.
- Restarts require a restart-capable verified hosting connection, such as Pterodactyl, Pelican or Nitrado. Exact server-name authorisation is still required when saving a restart workflow. The countdown announces five minutes and one minute before requesting the host restart.
- Backups require a backup-capable hosting connection. Pterodactyl and Pelican support the archive recipes; the current Nitrado connector does not. A simple backup task requests an archive; the workflow also waits for that specific archive job to complete. Provider completion is not a tested restore or a guarantee of live-world consistency.
- DayZ templates do not verify character persistence. Check your host shutdown behaviour and arrange stopped-server backups where needed.
- Connection checks confirm that the configured game connection responds. Recovery templates follow resolved Rookrift incidents. Notifications use workspace alert settings; successful RCON is not proof of every aspect of game health.

Unsupported recipes remain visible with a connection requirement and a disabled use button. Staff see only permitted target servers. Existing backend permissions, plan quotas, maintenance handling, provider capabilities, cooldowns and restart confirmation apply to saved copies. Selecting a template does not bypass any of them. No paid features, provider capacity or Discord delivery are enabled automatically.

## Deployment

Rebuild the app for version 0.23.0. There are no new dependencies, environment variables or database migrations; schema 25 remains current. The schedule API now accepts a boolean `enabled` on creation and full edits. Older clients retain the enabled-by-default creation behaviour, and an edit that omits `enabled` preserves the saved state. Existing schedules and workflows are unchanged.
