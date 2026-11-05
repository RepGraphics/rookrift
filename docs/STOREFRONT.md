# Community storefront

Release 0.9 adds one-time purchases, connected merchant accounts, verified payment history and a staff delivery queue. The store is separate from the owner's Rookrift subscription. The hosted ChatGPT Site simulates purchases in browser storage; deploy the Node service on your Dokploy domain for real payments.

## Enable payments on the service

Configure Stripe Connect for your platform, then set these in Dokploy's application environment (or encrypted **Platform admin → Global settings → Community store payments**, followed by a restart):

```dotenv
STRIPE_CONNECT_SECRET_KEY=
STRIPE_CONNECT_WEBHOOK_SECRET=
```

These are independent of `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, which continue to handle Rookrift subscription billing. Start with Stripe test credentials and a test connected merchant account. `APP_URL` supplies checkout/onboarding return URLs and must be the actual HTTPS application origin.

Create a Stripe webhook destination for **events on connected accounts** at `APP_URL/api/webhooks/community-stripe`. Subscribe to `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`. Put that destination's signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`. A platform-only webhook destination does not deliver the required connected-account events. See [Stripe direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted).

Checkout uses direct charges in each community's connected account. Merchant accounts use Stripe's full dashboard and Stripe-managed payment-loss responsibility. No additional Rookrift application fee is currently requested. Stripe's own processing/Connect fees depend on account arrangements. Keep payment modes aligned across keys, connected accounts and webhook destinations.

## Set up a community store

1. Save the community page first. Open **Community hub → Store & orders**.
2. Choose business country and store currency, explain delivery timing/contact details, and publish a refund policy. Country is locked once a merchant account is created; currency is locked after the first checkout reservation.
3. The workspace owner selects **Connect Stripe**, completes Stripe's hosted onboarding and returns to Rookrift. Select **Refresh payment status**. Returning from onboarding is not evidence of account approval.
4. Add products with a title, precise description, ASA/ASE game and a one-time price between 0.50 and 1,000 in the selected currency. Publish each product, enable the store and publish the community page.
5. Test a purchase, verified payment, staff delivery, refund and webhook retry before accepting real customers.

Unrestricted administrators can manage catalog/settings and delivery. Only the workspace owner can open merchant onboarding. Moderators, viewers and staff with a restricted server scope cannot manage the store. Product allowances are Scout 5, Tribe 25 and Cluster 100. Downgrades retain catalog/orders; only the oldest entitled products can be offered publicly. Archived products disappear from the catalog while their order history remains.

## Buyer and staff flow

Buyers sign in with a local account or Discord, read delivery/refund terms, supply a game identifier and continue to hosted Stripe Checkout. Identifiers are self-reported; staff should verify the recipient before delivery. Each order snapshots product contents, amount, currency, game, merchant account and delivery/refund terms. Editing a product cannot change an existing purchase.

Payment return URLs never mark an order paid. Signed webhooks and payment refresh retrieve the current Checkout session and expanded charge from the correct connected account, and validate the order reference, workspace, amount and currency. Repeated checkout requests reuse a committed order reservation and a stable Stripe idempotency key. A signed checkout event can recover a session accepted by Stripe when its creation response was lost. If an attempt is uncertain, check existing orders before starting another purchase.

Paid orders enter **Needs delivery or review**. Staff arrange delivery using their community's existing process, then select **Record delivery** with a buyer-visible note. Rookrift rechecks the payment before accepting the record and prevents duplicate fulfillment. This release does not automatically spawn items, execute arbitrary RCON commands, manage recurring supporter subscriptions or expire game/Discord perks.

Refunds are issued in the merchant's Stripe dashboard. Refund/partial-refund/dispute events update payment history and flag orders for staff review; they preserve prior delivery evidence. Staff decide any in-game reversal. Paid/pending orders with saved Checkout sessions are periodically reconciled for 90 days; webhook deduplication records are retained for 90 days. The management queue shows up to 200 orders, prioritising undelivered/review records. Buyers see only their own latest 50 orders, including after the storefront is disabled. An unpublished community's retained order history is available through its authenticated order API.

Card details are handled by Stripe. Public store responses exclude Stripe account/session identifiers and private staff/user data. Hosted payment URLs are restricted to Stripe's checkout/onboarding domains. Raw webhook bodies are signature-verified before processing. No real charge, merchant onboarding or provider request is made by the demo.
