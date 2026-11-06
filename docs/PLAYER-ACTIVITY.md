# Player activity and observed sessions

Release 0.22 adds **Players → Activity & sessions**, recent session history inside player profiles, observed-time rankings, a snapshot timeline and filtered CSV downloads. The selected Players tab survives reloads. Server, game, player/identifier, session state, reporting period and sorting filters apply to the same underlying history. A profile shortcut opens the relevant player's existing notes, moderation and server history.

## What the times mean

Rookrift checks player lists periodically, normally once a minute. A session starts when a reported identity appears in a successful snapshot. Estimated observed time runs only between consecutive sightings in that observation. A missing player closes it at their last positive sighting; a separate timestamp records when the absence was detected. A short visit between checks may be missed. The first snapshot is labelled **First observed**, rather than treating everyone already playing as a new arrival.

These are not exact login/logout logs or verified playtime. A failed player-list read, an unsupported parser response, a gap longer than three minutes, a runtime restart, a changed connection or a plan-paused server stops monitoring without claiming the player left. Recovery starts a new observation. Duplicate and out-of-order snapshots do not add sightings or extend time. Name changes update the same typed profile; names do not link different identities. Minecraft uses the server-reported Java username namespace; this does not prove permanent UUID ownership. ARK and DayZ retain their existing typed identifiers and game boundaries.

History starts with new successful checks after this release. Old first/last sightings are not turned into invented sessions. Rankings sum estimated observed time across the selected accessible servers; overlapping observations can be counted more than once and should not be treated as an exact engagement or reward measure. No automatic welcome messages, rewards, bans or game commands are issued by this feature.

## Privacy, plans and exports

Only authenticated workspace staff with access to the associated server can query its sessions, rankings or events. Explicit hidden-server and hidden-profile requests return not found. Viewers can read/export their permitted records; this adds no moderation capability. Activity is not published to community pages or shared ban reports.

Scout, Tribe and Cluster retain their existing 2/7/30-day history allowances. A larger requested period is capped at the workspace's effective plan. Sessions spanning the reporting boundary have their visible start and duration clipped to that period. Snapshot counts refer to the full observation, including samples before a clipped start. A paused server cannot appear as currently observed. Closed old sessions are pruned by the monitoring cycle; existing persistent profiles and notes retain their separate policy. Removing a server or an owning workspace deletes the associated sessions through foreign keys.

CSV downloads include the current filters and sort, UTC dates, identifier type, game/server, estimated seconds, full-session sample count, observation reasons and boundary clipping. They use the shared spreadsheet-formula escaping and are limited to 5,000 rows per download, with an explicit truncation notice. Use narrower filters for larger histories. The API returns an authenticated JSON download payload so the existing request/error handling applies.

## Deployment and validation

Back up PostgreSQL before schema 25. It adds `player_sessions` and `player_presence_checks`, partial uniqueness for open sessions and workspace/profile history indexes. Deployment remains one replica with stop-first updates. Runtime recovery closes prior open observations at their last sighting before monitoring resumes. Rollback to 0.21 requires restoring the matching schema-24 backup.

Automated checks cover polling gaps, transport failures, runtime recovery, connection edits, duplicate/concurrent snapshots, identity boundaries, scoped API/CSV access, query validation, retention/downgrade handling, CSV escaping, deletion and dashboard navigation/filter/retry/export flows. Real player-list support retains each adapter's existing live-validation limits. This does not implement native game/plugin join events, lifetime playtime, session-triggered rewards or achievement conditions.
