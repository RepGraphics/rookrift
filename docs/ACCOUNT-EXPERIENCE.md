# Accounts and navigation (0.14)

The dashboard navigation now groups servers and players, automation, community tools, and workspace/account administration. Personal settings are separate from workspace settings and platform administration.

## Community members

Open the avatar/name menu at the top of a community page. **Profile**, **Game accounts**, **Appearance**, **Sign-in & security**, and **Sign out** are available there. The account page also provides billing history and cancellation-gated account deletion.

- Profile name, username and uploaded picture belong to the global Rookrift account and appear immediately in the community header after saving. These use the same editor as the dashboard.
- An optional community nickname belongs only to that member in that community. It changes the name in their account menu; it does not change their login or in-game identity. Blank uses the global profile name. Nicknames are not a public member directory.
- **Game accounts** contains the single player connection flow: choose a published ARK server, generate a code, send it in global game chat, and wait for verification. Existing self-reported identifiers remain visible and removable. The duplicate manual-identifier form has been removed from the UI; the legacy API is retained for compatibility.
- Appearance remembers light/dark mode on this browser for this community. A community owner's fixed-theme setting is respected.
- Security includes email/password changes for accounts that have a local password, Discord sign-in, authenticator setup and passkeys. Security changes are read-only in the hosted browser demo.
- Sign out revokes the current session and keeps the visitor on the community site. Account settings and logout use the personal API, so visiting them does not provision a management workspace. Discord verification for deletion returns to a validated community address; cancellation, identity and authenticator checks still apply.

The public site's main navigation no longer includes a duplicate Game accounts section. Existing `/c/<slug>?page=account` links still open account management. The last account subsection is remembered for this tab, including a return from Discord verification. Member order history remains in Store/My orders.

Workspace owners use **Community hub → Linking diagnostics** to inspect native chat/panel connectivity and optional bridge credentials. This is a server troubleshooting screen; players connect their accounts on the public community site.

## Personal settings

**My account** in the dashboard has separate Profile, Sign-in & security, Appearance, Billing history and Delete account pages. Billing history is fetched when opened; profile editing no longer waits for payment-provider invoice requests. Dashboard appearance updates the header toggle immediately. Discord sign-in is labelled explicitly to distinguish it from verified game accounts.

## Platform settings

**Platform admin → Global settings** has four categories:

| Category | Contents |
| --- | --- |
| Email delivery | Existing live SMTP configuration, notification toggles and delivery status |
| Discord | Platform client ID, client secret and bot token |
| Subscriptions | Provider selection and only that provider's fields |
| Community payments | Stripe Connect credentials for community merchants |

Each integration category saves its own fields. Blank integration fields preserve saved values. Secrets stay encrypted and masked. Integration changes require a service restart and environment variables override stored credentials. SMTP administration continues to apply live. Changing subscription provider does not migrate existing subscriptions. Status/error feedback is visible across admin sections.

No database migration is required for this release; community nicknames use the existing `community_members.display_name` column. Normal session, origin/CSRF and ownership checks apply to every change. The demo simulates profile/nickname/linking and sign-out in browser storage without sending real account or server requests.
