# Navigation, bundles and Discord shopping (0.16)

## Restoring your place

The dashboard now records its selected page and section tabs in the address. For example:

```text
/dashboard?view=community&community=store&store=settings
```

Refreshing that address reopens **Community hub → Store & orders → Store settings**. Bookmarks and browser Back/Forward restore the selected sections too. Page choices remain in the URL as you move around the dashboard. This saves navigation only; it does not save unsent form contents, passwords, commands, selected player identities or open dialogs.

The same mechanism covers player tabs, workflows/history, configuration/history, operations, the community site editor, personal account sections and platform administration/settings categories. Staff fall back to a permitted page when a link selects an unavailable owner-only section. Backend role and server-scope checks remain authoritative. Known payment/OAuth return links still select their intended destination; internal redirect validation accepts only known page/tab values and rejects unexpected or duplicate parameters. Stripe merchant onboarding now returns directly to Store settings.

Workspace switching retains its existing behaviour of opening the destination workspace's overview/server page. Opening a fresh `/dashboard` address starts at its default page; a bookmark to a specific view restores that view. Public community account/navigation behaviour is separate.

## Package bundles

Open **Community hub → Store & orders → Create bundle** as the workspace owner. Select 2–6 saved packages for the same game, enter a title/description and one explicit bundle price, then choose staff delivery or combined automatic actions. Type the exact title to authorise the bundle. It is created as an unpublished draft, which you can review, edit and publish like another product.

An automatic bundle requires every source package to have purchase actions. The combined maximum remains six actions, and all RCON actions must accept the same recipient identifier type. Current server/Discord targets are validated again. Mixing staff-delivered source packages into automatic fulfillment is rejected; choose staff delivery for the whole bundle instead. Existing role restrictions, owner-only action authorisation, queue sequencing, uncertainty handling and payment verification still apply.

Bundles snapshot source package names and their configured actions at creation. Editing or archiving a source does not change the bundle. An order then snapshots that bundle again, so later bundle edits do not rewrite an existing purchase. Package contents are visible in the catalog, purchase review and order details. A bundle has its own availability and purchase limits; it does **not** decrement the separate source products' limits. This is one combined product/payment, not a multi-product shopping cart or an inventory-verifying game plugin.

Bundles count toward the normal product allowance. A bundle's game cannot be changed in place; create another bundle for a different game. Catalogs, discounts, images and the existing delivery queue work with the new product.

## Draft duplication

**Duplicate draft** copies a product's description, price, image, category, display order and bundle contents, if any. The copy starts unpublished and has no purchase actions or availability restrictions. Review delivery, limits and publication before offering it. Unrestricted catalog administrators may duplicate marketing/catalog data; automatic bundle creation remains owner-only.

## Discord `/shop` and `/orders`

The new guild-only commands complement the existing `/rookrift` management command:

- `/shop` privately previews up to five available packages and provides an **Open community store** button. Checkout, recipient choice and acceptance of purchase terms happen on the website.
- `/orders` privately displays up to five recent purchases from that Discord guild's linked workspace. The caller is matched through their verified Discord sign-in/link; it accepts no other buyer identifier. Unlinked users are directed to their community account. Game recipient IDs and payment credentials are not included in the reply.

Replies are ephemeral and suppress mentions. The administrative `/rookrift` command still requires **Manage Server**; these customer commands do not grant server-management access. The guild must have a single active linked workspace. The bot remains on the existing Guilds intent and does not read chat messages for these commands.

Register the updated definitions after deploying:

```powershell
docker compose exec rookrift node server/register-commands.js
```

For a local Node deployment, use `npm run bot:register`. The CLI prefers environment credentials and can also read the encrypted Discord application ID/token saved in Platform admin, using the configured PostgreSQL connection and encryption key. It prints command names, never credentials. `DISCORD_DEV_GUILD_ID` scopes registration to a development guild; otherwise definitions are global. Discord may take time to propagate global updates. Registering definitions does not send channel messages.

## Deployment

Schema **20** adds bundle-content snapshots to products and orders. Existing rows receive empty lists; existing payments and delivery actions are preserved. Back up PostgreSQL before upgrading; restoring schema-19 software requires its matching database backup. No new environment variables or dependencies are required.

The hosted browser demo supports bundle creation, publication, duplication and purchases using local sample data. It does not connect to Discord or charge payments. Test the bot and exact game commands in a development guild/disposable server before launch. Recurring supporter subscriptions, timed perk expiry, gift cards and a multi-product basket remain separate work.
