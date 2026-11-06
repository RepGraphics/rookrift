# Focused administration and password recovery (0.18)

The platform overview now shows three totals and the three latest admin events. Attention flags appear only when needed. User details separate **Account**, **Password**, and **Access & support**. Workspace details separate **Workspace settings**, **Discord & alerts**, and **Community page**. Global services use compact tabs. Email delivery separates **Connection**, **Notifications**, and **Delivery log**; unsaved connection/notification edits survive switching those email tabs.

## Reset a user's password

As a platform root, open **Users > Manage > Password**. Choose a method and type the account's current email to confirm the target.

- **Send reset email:** queues a one-hour reset link through the configured encrypted SMTP outbox. It does not immediately change the password or end sessions. Older reset links and queued recovery emails are replaced. The user chooses a new password through the existing recovery page. Check **Global settings > Email delivery > Delivery log** for actual delivery status; queued does not guarantee delivery. Email recovery needs enabled SMTP with a sender configured.
- **Generate temporary password:** immediately replaces the password with 24 characters from a cryptographically secure generator, revokes sessions and invalidates pending password/security challenges. Only a password hash is saved. The API returns the password once with `Cache-Control: no-store`. The dialog masks it, offers explicit Show/Copy controls and removes its result when the tab/dialog closes. It is never written to the URL, browser storage, email or activity log. Hand it to the verified account owner privately.

The generated credential expires after **24 hours**. When used at password sign-in, any existing authenticator check runs first. The user must then choose a different permanent password before a normal session is issued. That replacement step is tied to the verified credential and expires after five minutes. A subsequent reset, password change, suspension or newly enabled authenticator check prevents an older replacement challenge from completing. Completing a normal emailed reset also clears the temporary-password state. Existing Discord sign-in, passkeys and TOTP enrollment remain available; a password reset does not remove those methods.

These controls apply to active local email/password accounts. Suspended/deleting accounts must be restored first; external-only accounts have no local password. Platform root passwords are excluded from these support controls; use My account or the ordinary recovery flow for your own root account.

## Controls and records

The new GET/POST `/api/platform/users/:id/password-reset` endpoints enforce backend root access; writes also require the existing CSRF verification, an exact target-email confirmation and a UUID request reference. Writes are limited to 20 requests per IP per 15 minutes. Duplicate operation references cannot change a password twice or reveal an earlier generated password. If a response is lost, a new explicit reset request creates a new credential rather than retrieving the previous plaintext.

Reset writes, recovery-token changes and their platform activity event commit atomically under the target account lock. Activity records contain the actor, target and method, without passwords or reset tokens. SMTP sends happen later through the worker. Tests use isolated PostgreSQL and a mocked SMTP transport, with no real messages.

Schema **22** adds temporary-password state, short-lived replacement challenges and operation references. Expired temporary state remains until replaced so that an expired credential cannot become a normal password. Operation references are pruned after 90 days during reset operations; account deletion cascades their removal. No new environment variables or dependencies are required. Back up PostgreSQL before upgrading; rollback needs the matching schema-21 backup.

The private browser demo supports both choices with sample accounts. Demo credentials cannot sign in to real accounts, and the demo never sends messages. Generated demo passwords are also discarded from its persisted data.
