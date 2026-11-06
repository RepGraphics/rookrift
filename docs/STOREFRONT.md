# Community storefront

Release 0.10 adds product images, categories, catalog sorting and ordered purchase actions to the one-time Stripe Connect store. Products can use staff delivery or owner-configured server commands and Discord role awards. The store is separate from the owner's Rookrift subscription. The hosted ChatGPT Site simulates payments and delivery in browser storage; deploy the Node service on your Dokploy domain for real operations.

## Enable payments on the service

Configure Stripe Connect for your platform, then set these in Dokploy's application environment (or encrypted **Platform admin → Global settings → Community payments**, followed by a restart):

```dotenv
STRIPE_CONNECT_SECRET_KEY=
STRIPE_CONNECT_WEBHOOK_SECRET=
```

These are independent of `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, which continue to handle Rookrift subscription billing. Start with Stripe test credentials and a test connected merchant account. `APP_URL` supplies checkout/onboarding return URLs and must be the actual HTTPS application origin.

Create a Stripe webhook destination for **events on connected accounts** at `APP_URL/api/webhooks/community-stripe`. Subscribe to `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`. Put that destination's signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`. A platform-only webhook destination does not deliver the required connected-account events. See [Stripe direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted).

Checkout uses direct charges in each community's connected account. Merchant accounts use Stripe's full dashboard and Stripe-managed payment-loss responsibility. No additional Rookrift application fee is currently requested. Stripe's own processing/Connect fees depend on account arrangements. Keep payment modes aligned across keys, connected accounts and webhook destinations.

## Set up a community store

1. Save the community page first. Open **Community hub → Store & orders**.
2. Open **Store settings**, choose business country and store currency, explain delivery timing/contact details, and publish a refund policy. Country is locked once a merchant account is created; currency is locked after the first checkout reservation.
3. The workspace owner selects **Connect Stripe**, completes Stripe's hosted onboarding and returns to Rookrift. Select **Refresh payment status**. Returning from onboarding is not evidence of account approval.
4. Use **Categories** to organise the catalog, then **Catalog → Add product**. Set a title, precise description, ASA/ASE game, one-time price, optional public HTTPS image URL, category and display order. Images have a fallback cover; file upload hosting is not included. Lower display-order numbers appear first. Publish each product, enable the store and publish the community page.
5. Optionally configure **Purchase actions** on a saved product, following the guidance below. Test payment, delivery, refund, webhook retry and process recovery with test credentials and a disposable game world before accepting real customers.

Unrestricted administrators can manage catalog/settings and delivery. Only the workspace owner can open merchant onboarding, configure purchase actions or resolve an uncertain action. Moderators, viewers and staff with a restricted server scope cannot manage the store. Product allowances are Scout 5, Tribe 25 and Cluster 100, with up to 30 categories per workspace. Downgrades retain catalog/orders; only the oldest entitled products can be offered publicly. Sorting never changes entitlement. Archived products disappear from the catalog while their order history remains. Deleting a category uncategorises its products and preserves existing order snapshots.

## Automatic purchase actions

Open **Purchase actions**, enable automation, add up to six ordered steps, and type the exact product title to authorise the configuration. An empty action list uses staff delivery. Changes affect new checkout reservations; existing orders retain their original actions, targets, image, category and purchase terms.

**Server commands:** choose an entitled server running the product's game and its required recipient identifier type. Enter one RCON command per step, including `{identifier}`. The optional `{order_id}` placeholder supplies a stable order reference for a compatible plugin's own deduplication. Control characters, command separators and unknown placeholders are rejected. There is no universal item catalog or game delivery plugin bundled with Rookrift.

ARK's `GiveItemToPlayer`, `GiveItemNumToPlayer` and `GiveExpToPlayer` require the **numeric in-game PlayerID**. An EOS ID or Steam64 account ID is a different identifier; Rookrift does not convert between them. Use an EOS/Steam/UUID/plugin account ID only with a command that explicitly supports that type. Game identifiers are self-reported and must be checked by community staff. Test the exact command, item blueprint and recipient requirements on your own game version. RCON acknowledgment alone cannot prove inventory delivery.

**Discord roles:** link the workspace's Discord community in Settings, invite/re-authorise the bot with **Manage Roles**, and position its role above the reward role. Select a manageable non-staff role. Managed roles, `@everyone`, roles above the bot and roles carrying powerful staff permissions are excluded. The buyer must use **Discord sign-in** or link their Discord account through OAuth, and join that community. The catalog offers **Link Discord for role rewards** when needed. The recipient comes from the authenticated account's stored, verified Discord identity, never a buyer-entered Discord ID, and is saved with the order before payment.

Role grants add one role and preserve the member's other roles. An already-held reward is recorded without re-adding it. See Discord's [role API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild.mdx#add-guild-member-role) and [role hierarchy](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx#permission-hierarchy).

The PostgreSQL delivery queue is polled every five seconds by the single application runtime. Jobs are created only after authoritative Stripe payment verification. Before each action, the worker rechecks payment, server entitlement and the saved connection or Discord guild. An offline, busy or maintenance server waits between attempts for up to seven days; other preflight failures require staff review. Updating a saved server connection or linked guild blocks old targets for review rather than silently sending purchases elsewhere.

The worker commits an executing record before sending a game command. A lost reply, possible game error or interrupted command becomes **uncertain** and is never automatically replayed. Later steps wait. Discord role grants are idempotent and can be retried. Keep one application replica; this queue does not enable distributed workers.

## Review delivery

Use **Orders & delivery → View delivery actions** to inspect status, attempts and outcomes. **Retry blocked actions** rechecks payment and current conditions; it never resets an uncertain command. After checking the game, the owner can record that an uncertain step completed outside Rookrift or cancel that step with a reason. Cancelling skips the step and permits later steps to continue. This record does not resend a command. An order with cancelled steps remains for staff review until its final delivery is recorded.

## Buyer and staff flow

Buyers sign in, read delivery/refund terms, supply the configured game identifier when required, and continue to hosted Stripe Checkout. Role-only products need no game identifier. Role-enabled products require a verified Discord identity. Each order snapshots product contents, amount, currency, game, merchant account, delivery actions and delivery/refund terms. Editing a product cannot change an existing purchase. Catalogs have search, category filters and display/name/date/price sorting; the staff order queue also supports search and sorting.

Payment return URLs never mark an order paid. Signed webhooks and payment refresh retrieve the current Checkout session and expanded charge from the correct connected account, and validate the order reference, workspace, amount and currency. Repeated checkout requests reuse a committed order reservation and a stable Stripe idempotency key. A signed checkout event can recover a session accepted by Stripe when its creation response was lost. If an attempt is uncertain, check existing orders before starting another purchase.

Paid manual orders enter **Needs delivery or review**. Staff arrange delivery, then select **Record delivery** with a buyer-visible note. Rookrift rechecks payment and prevents duplicate fulfillment. Automated orders show queued actions or review status, then **Purchase actions complete** once all steps succeed. The completion note explains that game commands were acknowledged rather than independently verified in the player's inventory. Manual fulfillment cannot override pending, executing, blocked or uncertain action jobs.

Refunds are issued in the merchant's Stripe dashboard. Refund/partial-refund/dispute events cancel unsent actions and flag orders for review, preserving delivery evidence. An action already sent cannot be recalled. Items and Discord roles are **not automatically revoked**; staff decide any reversal, including whether a role predated the purchase or belongs to another entitlement. Recurring supporter subscriptions, timed perks, automatic expiry and automatic reversals remain future work. Paid/pending orders with saved Checkout sessions are periodically reconciled for 90 days; webhook deduplication records are retained for 90 days. The management queue shows up to 200 orders, prioritising undelivered/review records. Buyers see only their own latest 50 orders, including after the storefront is disabled. An unpublished community's retained order history is available through its authenticated order API.

Card details are handled by Stripe. Public store responses exclude command templates, target fingerprints, role/guild IDs, Stripe account/session identifiers and private staff/user data. Hosted payment URLs are restricted to Stripe's checkout/onboarding domains. Raw webhook bodies are signature-verified before processing. No real charge, merchant onboarding, game command or role change is made by the demo.

## Promotions and growth (0.15)

See [store growth](STORE-GROWTH.md) for coupon codes, scheduled sales, availability/claim limits, original checkout resumption/cancellation, aggregate analytics/CSV and opt-in monthly funding goals. The catalog and orders now snapshot base prices, discounts and first verified payment time. Free claims enter the same durable delivery queue without requiring configured Stripe credentials. Paid products require at least 0.50. Schema 19 is required. These additions do not add recurring supporter billing, gift cards or a verified external-provider payment API.
