# Platform support tools (0.19)

Platform administrators can now move from **Users > Manage > Account > Owned workspaces** directly into an owned workspace's details. Only active owned workspaces appear; staff memberships are separate. Closing the workspace dialog returns to the same user directory and search.

Open **Workspaces > Manage > Support** for an on-demand support snapshot:

- Stored game server status, player totals, map, plan eligibility and last-check timestamp.
- Open/unacknowledged incidents, blocked or uncertain delivery-action totals and unresolved paid orders.
- Community/store publication flags, staff-seat totals and active workflow-run totals.

This view reads saved database state. Refresh does not poll game/hosting APIs, run commands, retry delivery, change billing or impersonate an owner. An uncertain delivery may already have occurred; review it through the existing delivery workflow before taking action.

**Copy summary** and **Download JSON** export the same selected fields returned by the root-only `/api/platform/workspaces/:id/support` endpoint. Workspace/server names, internal record identifiers and cached status counts are included. RCON hosts/ports/passwords, provider credentials, raw player lists/identifiers, private notes, command templates, merchant account IDs and buyer/payment details are excluded. The response uses `Cache-Control: no-store`; it is held in component memory and exported only after an explicit click. Names remain in the export, so it is not an anonymous report.

The endpoint checks platform-root access and rejects missing or closed workspaces. It does not grant ordinary workspace staff access to the platform. The private browser demo simulates the snapshot without external requests.

Release 0.19 retains schema **22** and needs no new dependencies or environment settings. Rebuild the application normally; a rollback to 0.18 can use the same schema-22 database. Existing password-recovery controls from [0.18](ADMIN-PASSWORD-RECOVERY.md) remain available.
