# Plain Store Next Steps

This file is the working list for future Codex sessions.

## Core Goals

Keep the store:

- minimalist
- self-hosted
- fast
- server-rendered
- easy to operate locally
- clear in pricing and inventory
- low-noise for customers

Stay aligned with the current project constraints:

- no customer accounts by default, but keep this under review for repeat-customer efficiency
- no third-party tracking
- no SPA/frontend build pipeline
- no unnecessary external services

External services are acceptable when they solve a real store need with minimal complexity, such as transactional email.

## Design Tasks

1. Pay-at-pickup decision flowchart is now documented in
   [docs/pay-at-pickup-flow.md](/home/korgan/store/docs/pay-at-pickup-flow.md).
   Use it as the reference before changing order status, inventory release,
   partial fulfillment, no-show, or back-in-stock notification behavior.


2. Account direction is documented in
   [docs/pay-at-pickup-flow.md](/home/korgan/store/docs/pay-at-pickup-flow.md).
   Use a hybrid accountless model for now: no mandatory accounts, optional local
   "remember me" prefill later, and email/order-number lookup for order status.

## Highest Priority

1. Clarify and harden pay-at-pickup order flow.
   Treat the store as pickup-order/order-intent software first, not full online
   ecommerce.
   Customers can place an order or request without paying online, then pay at
   pickup.
   Make order status language clear enough that unpaid orders are not mistaken
   for completed paid sales.
   Add admin workflow for pickup requested, ready, picked up/paid, cancelled,
   no-show, and returned-to-stock states.

2. Production-safe admin auth baseline is implemented.
   Public deployment should use `ADMIN_PASSWORD_HASH`, admin login rate limiting
   is in place, and admin sessions expire after 12 hours.

3. Add pickup-only handling.
   The store is for local pickup only.
   Pickup location and instructions are now included in order emails via
   `PICKUP_LOCATION` and `PICKUP_INSTRUCTIONS`.
   Future improvement: optional pickup windows and owner-facing order prep cues.

4. Real SMTP delivery is configured on production.
   Order-submitted and ready-for-pickup emails are wired.
   Without SMTP settings, messages are written to `data/email_outbox/`.
   SMTP verification and a Plain Store smoke-test email passed on the Vultr
   server.

5. Decide whether to support SMS notifications.
   Some customers may prefer texts over email.
   Keep this optional and explicit: email, text, or both.
   Likely implementation path is a transactional SMS provider such as Twilio,
   with clear opt-in language and no marketing messages.
   Do not send SMS until the customer has provided a phone number and chosen
   text notifications.

6. Public deployment setup is live.
   Production runs on Vultr Shared CPU at `https://plainstore.net` with Ubuntu
   24.04 LTS, Caddy HTTPS, systemd, UFW, Node bound to `127.0.0.1:3001`, secure
   cookies, SSH key login, and password SSH login disabled.

## Admin Improvements

1. Improve order board workflow.
   Archive completed, cancelled, and no-show orders is now supported.
   Next useful additions:
   search by order number, email, or name
   filter by status
   sort options
   notes/history per order

2. Basic inventory warnings are implemented.
   Admin catalog now highlights active products with zero through five items
   remaining, including a warning summary above the products table and row-level
   stock labels.

3. Improve catalog editing ergonomics.
   Better image preview
   category sort order editing
   clearer product status handling

4. Add safer destructive actions.
   Confirm deletes consistently.
   Prevent accidental edits on live products where appropriate.

## Security Backlog

These came from the June 2026 review against common vibe-coded app failures:
frontend secrets, missing rate limits, missing route auth, and hardcoded
environment values.

1. Express proxy trust is tightened in code.
   The app now defaults `TRUST_PROXY` to `loopback` instead of trusting all
   forwarded IP headers. This matches same-host Caddy and protects IP-based rate
   limits from client-supplied `X-Forwarded-For` spoofing.

2. Order lookup and confirmation rate limits are implemented.
   `POST /order-lookup` is limited by IP and submitted order/email pair.
   `/order/confirm/:token` and `/back-in-stock/confirm/:token` have lightweight
   IP throttling.

3. Public order-detail exposure is reduced.
   `/order/:orderNumber` now redirects to order lookup. New direct order links
   use `/order/status/:token` with a high-entropy token whose hash is stored in
   the database. Order lookup still requires order number plus email.

4. Add remaining security regression tests.
   Current tests cover private order-status tokens, public order-number redirect,
   and order lookup rate limiting. Still add unauthenticated admin route access,
   admin mutation protection, and confirmation route throttling tests.

5. Keep checking for exposed secrets before deployment.
   Public assets should remain static UI only. Secrets should stay in `.env` or
   provider settings, never in `public/`, committed code, screenshots, docs, or
   generated client JavaScript.

## Storefront Improvements

1. Fix product detail page image/layout for the single egg product.
   Current live CSS avoids the worst blur by capping the image width, but the
   desktop layout still does not feel right because the low-resolution egg image
   and adjacent product text do not balance well. Next session should either:
   make the product detail page single-column until a better photo exists, or
   replace the egg image with a higher-resolution photo and then revisit the
   two-column layout.

2. Improve product page clarity.
   Keep stock and price prominent.
   Keep SKU secondary.
   Keep admin access visually unobtrusive.

3. Back-in-stock notifications are now implemented for out-of-stock product
   pages and admin inventory updates from zero to in stock.
   Cancelled/no-show inventory release now triggers notifications too.
   New notification emails now require confirmation before entering the queue,
   while previously verified order contacts can join directly.

4. Better cart stock-change feedback is implemented.
   Basket and checkout now explain when an item is removed because it is no
   longer available, removed because it is out of stock, or reduced because less
   inventory is available than the customer requested. Add/update quantity
   actions also explain when requested quantities are clamped to available
   stock.

5. Add better empty and unavailable states.
   Clear out-of-stock handling
   clear search no-results messaging

6. Decide storefront product sorting.
   Products currently sort by category sort order, then product name. Choose a
   store-owner-friendly order before the catalog grows: manual sort order,
   newest first, category groups, in-stock first, or featured products first.
   If manual ordering wins, add a product sort field and admin controls.

7. Improve image handling.
   Product photos should use the agreed standard: JPG, 4:3 landscape, preferred
   size 1200 x 900 px, minimum 800 x 600 px, under 300 KB.
   Optionally add a lightweight image validation/resizing step during admin
   upload workflow so the store can enforce this automatically.
   Immediate need: get a higher-resolution real egg photo for
   `Farm Eggs, 1 dozen` so homepage and product page media do not have to rely
   on layout constraints to hide blur.

8. Add a few trust details without clutter.
   Pickup policy
   return/refund policy
   contact email or contact page

9. Design future delivery eligibility with a Civics/access-boundary mindset.
   If local delivery is added later, keep it bounded and repairable rather than
   punitive or opaque. Delivery can be a higher-trust option than pickup, with
   admin-visible factual incident notes, simple eligibility states such as
   normal, prepay-required-for-delivery, pickup-only, or blocked, and a manual
   path back to normal after successful orders. Avoid hidden reputation scoring
   or character labels.

## Operations

1. Deployment runbook for the Vultr production path is documented in
   [docs/deployment-runbook.md](/home/korgan/store/docs/deployment-runbook.md).

2. Full real checkout smoke test passed.
   Smoke order `ORD-53FCE6B4` verified add to basket, checkout, confirmation
   email, confirmation link, inventory decrement, admin order board, ready
   email/status update, cancelled status with inventory returned, and archive.
   Inventory ended at four dozen available. Post-test backup:
   `backups/vultr/store-2026-05-28T21-33-28.831Z.db`.

3. Initial automated tests for critical paths are implemented.
   `npm test` covers seed catalog sanity, order creation and inventory
   reservation, insufficient-stock rejection, email confirmation order creation,
   contact verification, inventory release idempotency, archive/unarchive,
   backup readability, HTTP cart stock-change feedback, and admin product edit
   routing. Remaining useful coverage: order lookup, more admin order transition
   route tests, and restore drills.

4. Backup and restore verification is documented in
   [docs/backup-restore.md](/home/korgan/store/docs/backup-restore.md).
   The backup script was fixed to use SQLite's online backup command so WAL
   databases are copied safely. A verified production backup was copied to
   `backups/vultr/store-2026-05-28T19-47-04.642Z.db`.

5. Off-server backup pull automation is implemented.
   Production has Vultr automatic backups and a daily local
   `plain-store-backup.timer`. Run `npm run backup:pull-vultr` locally to copy
   missing `store-*.db` files from `/opt/plain-store/backups/` to
   `backups/vultr/` and verify the newest valid backup. A local user systemd
   timer, `plain-store-backup-pull.timer`, runs the pull command on startup and
   daily around 19:30 local time.

6. Add better operational logging.
   Keep request logging simple.
   Add clearer error logging for pickup-order failures.

7. Add a short release checklist.
   Restart service
   verify homepage
   verify pickup order submission
   verify admin login
   verify backups

8. Convert production deployment to a git-based flow.
   The laptop repo is currently the source of truth while `/opt/plain-store` is a
   hand-copied runtime directory, which makes drift easy. Move production toward
   a real deployment checkout with `.env`, `data/`, `backups/`, and
   `node_modules/` kept server-local. Target deploy flow: commit locally, push,
   pull on the server, run `npm ci --omit=dev`, restart `plain-store`, then run a
   smoke test.

## Probably Not Needed

Avoid these unless there is a strong business reason:

- mandatory customer accounts
- recommendations/personalization
- analytics scripts
- heavy client-side frameworks
- complex marketing popups
- feature creep in the storefront

## Suggested Next Implementation Order

1. Convert production deployment to a git-based flow
2. Add remaining security regression tests for admin route/mutation protection
3. Fix product detail image/layout for the current single egg product
4. Add trust details: pickup policy, return/refund policy, contact
5. Extend automated tests: admin order routes and restore drill
6. Tax/business-rule review if the store becomes active beyond informal local sales
7. Stripe Checkout integration only if the store is ready to become real ecommerce
8. Webhook-based order payment confirmation
