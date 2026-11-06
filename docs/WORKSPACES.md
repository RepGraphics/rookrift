# Separate workspaces

Use **New workspace** beside the header's **Active workspace** selector to give another game, cluster or community its own setup. Choose a name and game focus: multiple games, ARK Ascended, ARK Evolved, Minecraft Java or DayZ. You can own up to ten workspaces, in addition to accepted team invitations.

Each workspace has its own server connections, schedules, workflows, team permissions, activity, community page, catalog, order queue and billing. A new workspace starts empty on Scout, with an unpublished community page. A paid subscription on one workspace does not upgrade another. Workspaces do not automatically move or duplicate existing servers or purchases.

Game-focused workspaces accept matching connections. Mixed workspaces accept all available games within their shared server allowance. Minecraft Java and DayZ have beta adapters with game-specific capabilities; see [multi-game setup](MULTIGAME-AND-DELIVERY.md).

The selector lists accessible workspaces by name and shows a focused game's label. Selection belongs to the current login session. Switching returns to the overview and resets page-specific state. The API verifies membership and current server grants on every request; guessing a workspace ID grants no access. An administrator, moderator or viewer can create a separate workspace they own without gaining ownership of the workspace they were invited to.

Community slugs remain globally unique, so each published page has its own `/c/your-slug` address. A Discord guild can be linked to one workspace at a time to keep bot routing unambiguous. Use separate guilds for separate linked communities, or keep a shared guild attached to the workspace that should receive its bot commands and role rewards.

The browser demo also supports multiple workspaces. It saves each workspace's data separately in local storage and simulates switching and purchases; these records do not create live accounts or servers.

See [team permissions](TEAM-AND-PLAYERS.md) and [store delivery](STOREFRONT.md) for scoped access and purchase setup.
