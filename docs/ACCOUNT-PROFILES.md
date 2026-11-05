# Account pictures

Release 0.13.1 shows a user's profile picture in the dashboard sidebar and header, staff account button, profile editor, owner/team list, platform user list, platform header and signed-in community account menu. Missing or broken pictures fall back to initials in the same sized circle. Pictures are cropped visually to fit their container; the original upload remains in PostgreSQL.

Open **My account → Profile** to upload a PNG, JPEG or WebP image up to 3 MB. The editor previews a selection before saving. Save applies the picture and name to the current dashboard immediately, without waiting for its next background refresh. Remove picture is an explicit saved change. Cancelling a picture change restores the saved preview. The browser demo saves only to its local sample data and makes no real profile request.

Uploaded photos are served from an authenticated `/api/account/avatars/:userId?v=...` endpoint. A user can retrieve their own photo, a workspace owner can retrieve current team members' photos, and platform roots can retrieve platform photos. Other requests return no image. Access is checked again on conditional requests, so removing a team member does not leave a cached authorization grant. Responses use private revalidation and a content-derived version/ETag; account lists return a small image URL instead of repeating base64 image content. Team permission checks do not fetch picture blobs.

The public community response includes only the signed-in visitor's own picture. Anonymous community visitors do not receive account pictures. Profile pictures do not imply that a game player identity belongs to a particular Rookrift account.

Discord sign-in records provider avatar hashes. These are resolved with the linked Discord ID into the provider's documented image URL; a local account UUID is never substituted for a Discord ID. Animated hashes are supported. Signing in refreshes provider details while preserving an uploaded custom picture. If no custom upload is present, Discord sign-in can import the current Discord picture. Uploaded pictures and Discord pictures use the same rendering/fallback component. See [Discord's official image formatting reference](https://github.com/discord/discord-api-docs/blob/main/developers/reference.mdx#image-formatting).

Updating a name or username without an image change preserves the existing upload or Discord picture. The profile endpoint accepts a 5 MB JSON envelope, keeping the decoded image limit at 3 MB. Other API requests keep their existing small body limit. If a reverse proxy imposes a lower upload limit, allow this profile route's envelope there too.

No database migration or new service is required. The existing account-picture field is reused. Account deletion removes that field with the user, and previously issued image URLs then fail authentication or lookup. Normal backup retention remains a separate operator responsibility.

Tests cover upload size limits, name-only edits, removal, provider resolution, OAuth upload preservation, private image access/revocation/cache revalidation, metadata-only account lists, preview validation, fallbacks and immediate UI/demo updates.
