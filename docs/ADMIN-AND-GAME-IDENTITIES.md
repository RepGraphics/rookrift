# Admin experience and game identities (0.17)

## ASA and ASE shop recipients

Standard staff-delivered ASA products now require an **EOS ID** (32 hexadecimal characters). ASE products require a **Steam64 ID** (17 digits). The public catalog supplies the game's required format; checkout labels, help, input validation, saved-account filtering and backend validation agree. A saved identity must belong to the buyer, workspace and game and match the product's required format. Incorrect legacy identities are retained for review but cannot be selected for a standard checkout.

New server-command actions start with the product's game account type. ASA actions cannot use the Steam account type; ASE actions cannot use the EOS account type. Owners can explicitly choose a numeric in-game PlayerID or a plugin-specific/UUID identity when their command requires it. Built-in commands such as `GiveItemToPlayer` and `GiveExpToPlayer` still require numeric character IDs, not EOS/Steam account IDs. Rookrift does not translate account IDs to character IDs. Use a compatible plugin command for EOS/Steam delivery.

Existing order identifiers, purchase-action snapshots and delivery jobs are unchanged. Existing products configured with the other game's account type require owner review before a new checkout can succeed. Discord-only products continue to use the buyer's verified Discord account without requesting a game identifier. Bundles follow the same rules.

## Platform administration

Open `/admin` as a platform root. The sidebar separates Overview, Users, Workspaces, Admin activity and Global settings. Each page has one heading and a specific task. The overview uses saved account and billing flags rather than claiming to verify runtime health.

- **Users:** search name/email, filter active/suspended/root accounts, sort, and browse ten records per page. Manage opens a focused account dialog. Support view, session revocation and suspension require an explicit confirmation inside it. Root support actions are excluded from this screen.
- **Workspaces:** search name/owner/plan/status, filter membership state and sort by name, creation or server count. No workspace is opened automatically. Manage opens workspace settings and community-page tabs. The admin response includes separate join/staff settings; editing a page preserves its existing logo and builder design.
- **Global settings:** four service cards replace the nested settings sidebar. Email, Discord, membership payments and merchant payments are edited separately. Credentials remain encrypted, blank inputs preserve saved values and environment precedence is unchanged. Email applies immediately; Discord/payment configuration needs a restart.
- **Admin activity:** root-only, searchable/sortable records of account restrictions, revoked sessions, support-session starts, workspace/community edits, integration changes and SMTP configuration updates. The latest 100 events from a rolling 90-day window are shown. Pruning runs on log reads/writes. Logs contain fixed action metadata and current actor/target names, not credential values, form contents, emails, tokens or payment data. Deleted user/workspace references are cleared by database foreign keys. Failed mutations roll back their corresponding record.

Email test/retry actions, the end of a support session, direct database changes and ordinary workspace-owner changes are not part of this platform log. It is an operations aid, not a tamper-proof external audit system. Backend root checks and CSRF protection remain authoritative. Navigation restores the selected admin page and integration category on refresh. Directory filters, unsaved form values and open record dialogs are not persisted.

## Demo and deployment

The hosted browser demo includes `/admin`. It uses separate local sample data and never sends emails, changes external accounts or configures real payment services. Demo credential input is discarded; only configured flags are stored. The live build uses authenticated backend endpoints.

Back up PostgreSQL before upgrading. Schema **21** adds the platform activity table and indexes. There are no new dependencies or environment variables. Rebuild the app with the existing Compose/Dokploy configuration. Restoring older software requires its matching schema-20 database backup. The Privacy Policy now describes the platform activity retention window.
