# Email delivery and account screens

Release 0.21.1 adds a connection/authentication check that sends no email, safe SMTP failure stages/codes, preserved errors after message expiry, and explicitly acknowledged automatic STARTTLS compatibility. Existing connections still require encryption. No schema change is needed. Release 0.20.1 fixed SMTP test parsing errors with queued delivery and readable non-JSON proxy/rate-limit errors in administration.

Release 0.13 adds a shared responsive account layout, a public `/forgot-password` route, a clear recovery success screen and password confirmation when choosing a new password. Registration and sign-in retain selected plans and approved community return links. Dark/light mode and legal-policy links are available throughout. The hosted browser demo never creates accounts, resets passwords or sends email.

## Configure SMTP in administration

Sign in as a platform administrator, open `/admin`, choose **Global settings**, then **Email & SMTP**. Workspace owners do not have access to these platform controls.

1. Enter the SMTP host, port, TLS mode, credentials and sender email supplied by your email provider. Use STARTTLS on the provider's submission port (commonly 587), or implicit TLS (commonly 465). Certificate checks remain enabled. An optional reply-to address directs support replies.
2. Enable delivery and save. Changes apply immediately; the existing Discord/payment integration settings still require their documented service restart. SMTP settings stored in administration override the matching environment defaults. Secrets are encrypted using the existing stable encryption key. A blank password preserves the saved secret; the removal checkbox explicitly clears it.
3. Save edits, then select **Check connection (no email)**. It connects and authenticates using the saved mode, without sending a message or creating an outbox entry. This checks access from the application host; it does not prove sender acceptance or inbox delivery. Both diagnostics require platform-root access and CSRF validation, and have separate five-per-15-minute rate limits.
4. Select **Send test to my account**. This queues a test for the current admin's local account email, not an arbitrary recipient. The HTTP response confirms queuing; it does not wait for SMTP. Open Delivery log to see acceptance or a connection/authentication error; the log refreshes while open. SMTP acceptance does not guarantee inbox placement. Check spam and the email provider's delivery logs; verify the sender domain and configure its provider-specified SPF/DKIM/DMARC records. Tests expire after 15 minutes and make one delivery attempt. Failed or interrupted tests require an explicit retry; interrupted delivery may already have reached the inbox.
5. Enable purchase confirmations, community-owner sales alerts and/or membership payment confirmations as required. No marketing campaigns are included. Discord-only accounts without a local account email are skipped; no address is guessed from a Discord identity.

Environment fallbacks are `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`starttls`, `tls` or explicitly selected `auto`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_REPLY_TO` and `SMTP_ENABLED`. `SMTP_SECURE=true` remains a legacy TLS fallback when `SMTP_SECURITY` is absent. If `SMTP_ENABLED` is absent, a complete legacy host/from configuration enables password-reset delivery. The optional notification flags are `EMAIL_RECEIPTS_ENABLED`, `EMAIL_SALES_ENABLED` and `EMAIL_BILLING_ENABLED`; they default off. Do not commit real credentials. No changes to Redis are required.

## Connection security and provider differences

- **STARTTLS** requires an encrypted upgrade before authentication. An `ETLS / STARTTLS / SMTP 502` error means the relay rejected that command before login; changing the password will not fix that stage.
- **TLS** starts an encrypted connection immediately. Use only the endpoint and port confirmed by the provider. A timeout from one machine does not establish connectivity from the Dokploy host.
- **Automatic STARTTLS** upgrades when advertised by the server, but may otherwise transmit credentials and email without encryption. Saving this mode in administration requires its explicit acknowledgement checkbox. API clients must include `allow_insecure: true`; choosing `SMTP_SECURITY=auto` in deployment configuration is also an explicit operator choice. There is no automatic downgrade from the other modes. Certificate verification stays enabled whenever TLS is used.

Prefer enabling TLS on the relay or using a verified encrypted submission endpoint. Two applications can behave differently with the same host, port and credentials when one permits unencrypted fallback and the other requires STARTTLS. Do not disable certificate validation to work around a server that does not offer STARTTLS.

Errors show allowlisted SMTP codes, stages and numeric response codes, without raw provider replies, recipients or authentication payloads. Expiry clears message content while preserving an existing diagnostic for the remaining 30-day history. Older records whose errors were already overwritten cannot be recovered by this update. See [Nodemailer SMTP options](https://nodemailer.com/smtp) for connection and verification behavior.

## Password recovery

The public recovery response is identical for known and unknown addresses, including when email is disabled. Configured requests create a random one-hour reset link whose token is hashed in the reset table. Its queued email content is encrypted. Requests for the same account have a short resend cooldown. If an address has no password-based account, no reset is sent.

A successful reset updates the password, invalidates other reset links and pending login challenges, revokes existing sessions and cancels unsent reset messages. Tokens are single use. Resetting a password does not disable an existing authenticator. Recovery and sign-in endpoints are rate limited.

## Two-step password sign-in

Sign-in initially asks only for email and password. If those credentials are valid and an authenticator is enabled, the backend returns a five-minute challenge in an HttpOnly, SameSite cookie. The page then asks for the code and waits for a separate submission. No authenticated session is issued before the second step succeeds. Accounts without an authenticator sign in normally.

Challenges are tied to the user and current password hash, have a five-attempt limit, expire and can be consumed only once. The code request does not include or retain the password in a hidden form. The user can return to the email/password form to start again. Existing authenticator secrets remain valid; this release fixes an invalid buffer operation in their verification and generates new secrets using standard Base32 encoding.

## Sales messages

Stripe Connect orders queue a buyer payment confirmation and/or workspace-owner sales alert only after the existing authoritative charge checks mark the order paid. Reconciliation and webhook retries use the order ID to deduplicate notifications. Free orders do not generate paid-sale emails. Delivery remains separate: a payment email does not claim that a game command, item or Discord role has been delivered.

Stripe membership confirmations use a verified `invoice.paid` webhook followed by a current invoice fetch. Invoice IDs deduplicate the message. Existing invoice history is not emailed when a toggle is enabled. Payment timestamps and notification activation times prevent old payments being replayed as new sales. PayPal and generic hosted-checkout sale emails are not connected in this release. Payment-provider receipts remain independent and may also be sent by that provider.

## Queue, failures and retention

PostgreSQL holds the durable outbox. A worker checks every five seconds in the existing single application runtime. SMTP calls have bounded connection/socket timeouts. Failures retry with backoff up to five attempts, and administrators can retry unexpired failed messages after fixing configuration. Expired messages are cancelled. Turning off a notification type cancels its queued messages; turning off all SMTP delivery pauses sending. Delivery uses current recipient addresses and skips closing/deleted accounts. Account deletion removes that user's queued records through the user foreign key.

Email delivery is at least once: if the relay accepts a message but its acknowledgment is lost, a retry can duplicate it. A stable Message-ID is retained for the attempt series, but inbox deduplication is not guaranteed. SMTP acceptance does not guarantee inbox delivery. The queue is not an external delivery/bounce tracking service.

Bodies and reset links are encrypted while queued and cleared after confirmed SMTP acceptance. Expiry also clears pending/failed content. The worker removes delivery history after 30 days, including while SMTP is disabled. Provider-held messages and infrastructure backups follow the operator's separate retention arrangements. Recent status shown in administration omits recipient addresses, message bodies, tokens and credentials.

## Upgrade and checks

Migration 18 adds login challenges and the email outbox. Back up PostgreSQL and keep the encryption key before a stop-first, single-replica deployment. The remote basic-account setup is a separate operation; it does not migrate an external database or grant platform administration.

Automated checks cover admin authorization and CSRF, encrypted settings, masked responses, generic recovery, single-use reset links, session revocation, deduplicated sales, delivery retries, authenticator challenge expiry/attempt limits and separate UI submissions. Test with your real SMTP provider and a disposable account before relying on password recovery. No live SMTP credentials are supplied by this release.
