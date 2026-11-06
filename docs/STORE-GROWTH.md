# Promotions, purchase limits and sales (0.15)

This release adds native Rookrift coupons, scheduled sales, product availability, purchase limits, store reporting and an optional funding goal. The flows take inspiration from [GameServerApp discounts](https://docs.gameserverapp.com/dashboard/monetization/discounts/) and [Tebex coupons](https://docs.tebex.io/creators/tebex-control-panel/engagement/coupon-codes); they are Rookrift features, not a claim of full parity or a new Tebex payment integration.

## Promotions

Open **Community hub → Store & orders → Promotions**. Create a coupon code or an automatic sale, choose a percentage (1–95%) or fixed amount, and select all products, specific products, or categories. Optionally set a minimum base product price, start/end times, a total usage limit and a per-Rookrift-account limit. Times entered in the editor use your browser's local timezone and are stored as timestamps.

Without a code, the largest eligible automatic discount applies. Entering a valid coupon replaces the sale; discounts never stack. A paid product retains a minimum charge of 0.50 in the store currency. Products deliberately priced at zero use the free-claim flow and do not consume promotions. Names and code eligibility are validated by the server; secret coupon lists are never returned to the public catalog.

The default promotion allowances are Scout 10, Tribe 50 and Cluster 200 active/non-archived definitions. Archive an old promotion to free a definition slot. Archived coupon codes cannot be reused for another campaign, and the promotion type/code cannot be changed on an existing definition. You can edit its schedule, amount, targets, availability and limits. Existing order reservations keep their original discount and price.

Rookrift promotions apply to **Stripe Connect purchases**. An external hosted PayPal/Tebex checkout manages its own prices/promotions; the Rookrift sale is not displayed or applied there. Existing external-provider integrations still need authoritative provider payment confirmation before automatic delivery; setting a hosted URL alone does not verify payment.

## Availability and limits

Use **Catalog → Availability & limits** on a product. Choose an optional total stock/claim limit, a limit per Rookrift account, and an availability window. Blank limits mean unlimited; stock zero marks a product sold out. Limits apply to free claims too.

Creating a checkout reserves a stock slot, a customer purchase and a promotion use in the same PostgreSQL workspace transaction. Concurrent checkouts cannot take the final slot twice. Expired or failed payments release their reservations. Paid, partially refunded, refunded and disputed purchases remain counted toward stock/customer/coupon limits; a refund is not an automatic restock. Raise a stock limit explicitly when appropriate. These are account limits, not proof that different Rookrift accounts belong to different people.

Stock refers to Rookrift purchase capacity. It does not inspect an ARK inventory or guarantee that a server/plugin can deliver a particular item.

## Checkout and recovery

Buyers can review a price breakdown, apply/remove a code, and explicitly choose one of their saved game identities or enter a recipient manually. A saved identity is offered only when its game and identifier format suit the product. Rookrift no longer silently replaces a manually entered recipient with the first saved identity. Game account management stays under **My account → Game accounts**.

The server recalculates every new purchase, checks the displayed amount/currency, and snapshots price, discount, terms and actions before contacting Stripe. A changed price requires a new review. Stripe receives a discounted line-item price; Rookrift retains the base price and savings in its own order record. Stripe is charged the reserved amount using [Checkout price data](https://docs.stripe.com/api/checkout/sessions/create); browser amounts cannot set the amount charged. The checkout request no longer sends the unsupported PaymentIntent-only `automatic_payment_methods` field. Checkout uses the merchant's eligible dashboard-configured payment methods.

**Your orders → Resume checkout** retries the original order/idempotency key and keeps its reserved price, even after a sale ends or its own reservation uses the last slot. **Cancel unpaid checkout** checks Stripe and expires an open unpaid session before releasing capacity. A payment completed during cancellation remains a paid order. Staff have **Orders & delivery → Close unpaid checkout** for the same reconciliation.

A lost Stripe response can leave a real payment link active without its session ID reaching Rookrift. Such a reservation cannot safely be discarded. Retry the original checkout and let signed webhooks/reconciliation recover it; contact support if it remains unresolved. External hosted URLs cannot be revoked through this generic flow. Merely closing a browser tab does not release a reservation. Known Stripe links expire on their one-hour schedule and are released after provider verification.

Free claims require no configured payment provider. They become paid-at-zero orders and enter the existing durable delivery queue. Manual fulfillment remains available, and server/Discord actions retain the existing owner authorization, payment, target and uncertainty checks. No paid purchase is made free by a coupon.

## Reporting and funding goal

**Sales analytics** provides 7/30/90/365-day charts, daily tables/CSV, paid order count, average order, customer savings and top product snapshots. Figures use verified paid purchases after discounts, before processor fees. Refunded, partially refunded and disputed orders are excluded entirely; the figures are not an accounting profit statement. Free claims are separate. Delivery/review counters cover all orders; sales/free-claim periods use UTC days.

New orders retain the Stripe charge timestamp when available, falling back to the first verification time. Historical orders migrated from schema 18 use their original checkout creation date because an exact payment timestamp was not previously retained. Reverification does not move a sale to a later day. Product edits do not rewrite historical titles or prices. CSV uses escaped cells and contains aggregate daily data, not buyer identities.

In **Store settings**, optionally enable a monthly funding goal, choose a title and target, then save it. Progress is calculated from confirmed paid purchases in the current UTC month, after discounts and excluding free/refunded/partially refunded/disputed orders. It resets automatically each UTC month. Public output contains aggregate progress only. There is no manually inflated starting amount, and the goal is hidden by default.

## Deployment and remaining work

Schema **19** adds promotion records, availability fields and order pricing/payment-time snapshots. Back up the active PostgreSQL database before deploying. Existing catalogs, delivery actions and orders are retained. Rolling back to schema-18 software requires restoring the matching database backup. No new credentials or environment variables are required. Keep the single application runtime and the existing signed Connect webhook.

The browser demo implements these flows in local sample data without payments, real commands, Discord messages or emails. Live Stripe/game verification is still required on a disposable test community before accepting real purchases. Recurring supporter subscriptions, expiring perks, gift cards, a multi-product basket, inventory-verifying delivery and additional payment-provider APIs remain separate work.
