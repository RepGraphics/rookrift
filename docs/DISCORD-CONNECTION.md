# Saving a workspace Discord connection

Release 0.13.2 fixes Workspace Settings for email-based accounts. The previous link-account callback saved a Discord identity but did not request the `guilds` OAuth scope or retain its access token, so server linking could fail with an internal decryption error. New links request `identify guilds` and store the access token encrypted with the existing integration key.

## Connect and save

1. Open the intended workspace's **Settings**. Copy the Discord server ID and optional text-channel ID using Discord Developer Mode. IDs remain strings; surrounding whitespace is removed without converting long snowflakes to JavaScript numbers.
2. A regular workspace owner uses **Connect Discord**, or **Reconnect Discord** if linked previously. Their Discord account must have Manage Server or Administrator permission in the selected server. Older links need a reconnect to grant server-list access. Email/password sign-in remains available.
3. Platform roots can verify the connection through the bot directly, without attaching a personal Discord identity. This uses the server-verified platform role; a client request cannot grant that privilege.
4. Invite Rookrift to the Discord server and ensure the bot is online. The alert channel must belong to that server and allow the bot to view it and send messages. For a thread, the corresponding thread-send permission is checked. Root operators can configure the bot token in **Platform admin → Global settings** and restart the service to apply it.
5. Save changes. The resulting guild name comes from Discord. Validation failures leave previous settings intact and remain visible beneath the form. Normal name/alert-toggle changes do not force a fresh Discord login when IDs have not changed.

Changing the selected server clears the old channel in the form. Clearing the server also unlinks its alert channel. A Discord server currently belongs to one Rookrift workspace: switch to that workspace, or unlink it there before assigning it elsewhere. This preserves the existing slash-command routing rule; this release does not introduce shared-guild workspace routing.

## Reconnection and safeguards

The connection button retains the unsaved form in tab-local session storage for ten minutes, scoped to the Rookrift user and workspace. The callback returns to `/dashboard?settings=discord` and restores that draft. Values still need to be saved explicitly. Only approved internal return paths are accepted. A callback cannot attach credentials after switching to another account, and support impersonation cannot connect a Discord identity.

Missing/expired authorization, absent bot membership, wrong-server channels, missing bot permissions, concurrent connection changes and an already-linked guild produce actionable errors. No message is sent as part of saving or checking these settings. Monitoring alerts still follow the existing alert and maintenance preferences.

No database migration or additional environment variable is required; schema 18 remains current. Existing root-managed IDs remain in place. Use one runtime with the normal stop-first update. See [Discord's OAuth scope reference](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx) for the provider's `identify` and `guilds` scopes.

Regression tests cover local-account failures, successful OAuth reconnection and encrypted credential storage, root authorization, channel checks, atomic failure handling, whitespace and long IDs, approved returns, preserved drafts and browser-demo saves.
