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

2. Add production-safe admin auth.
   Replace the single shared password with something safer for an internet-facing store.
   Minimum acceptable path: hashed password, rate limiting, and better session handling.

3. Add pickup-only handling.
   The store is for local pickup only.
   Pickup location and instructions are now included in order emails via
   `PICKUP_LOCATION` and `PICKUP_INSTRUCTIONS`.
   Future improvement: optional pickup windows and owner-facing order prep cues.

4. Configure real SMTP delivery.
   Order-submitted and ready-for-pickup emails are wired.
   Without SMTP settings, messages are written to `data/email_outbox/`.
   Add production SMTP credentials before relying on email delivery.

5. Decide whether to support SMS notifications.
   Some customers may prefer texts over email.
   Keep this optional and explicit: email, text, or both.
   Likely implementation path is a transactional SMS provider such as Twilio,
   with clear opt-in language and no marketing messages.
   Do not send SMS until the customer has provided a phone number and chosen
   text notifications.

6. Finish public deployment setup.
   Current preferred path is Hetzner Cloud for a small Node + SQLite app.
   Choose Cloud, not Web Hosting, Managed Server, Dedicated Server, Storage Box,
   Object Storage, Load Balancer, or Server Auction.
   Start with Shared Resources -> Regular Performance -> smallest US instance,
   likely `CPX11`, in Ashburn, Virginia.
   Use Ubuntu 24.04 LTS or Debian 12, public IPv4 plus IPv6, and a firewall
   allowing `22`, `80`, and `443`.
   Use Caddy for HTTPS and reverse proxy to the Node app.
   Replace placeholder domain in `Caddyfile`, point DNS to the server, confirm
   HTTPS, secure cookies, and service restart flow.
   Enable backups once the store matters operationally.

## Admin Improvements

1. Improve order board workflow.
   Archive completed, cancelled, and no-show orders is now supported.
   Next useful additions:
   search by order number, email, or name
   filter by status
   sort options
   notes/history per order

2. Add basic inventory warnings.
   Show low-stock products in admin.
   Highlight out-of-stock items before customers hit product pages.

3. Improve catalog editing ergonomics.
   Better image preview
   category sort order editing
   clearer product status handling

4. Add safer destructive actions.
   Confirm deletes consistently.
   Prevent accidental edits on live products where appropriate.

## Storefront Improvements

1. Improve product page clarity.
   Keep stock and price prominent.
   Keep SKU secondary.
   Keep admin access visually unobtrusive.

2. Back-in-stock notifications are now implemented for out-of-stock product
   pages and admin inventory updates from zero to in stock.
   Cancelled/no-show inventory release now triggers notifications too.

3. Add better empty and unavailable states.
   Clear out-of-stock handling
   clear search no-results messaging
   better cart feedback when stock changes

4. Improve image handling.
   Use consistently sized local images.
   Optionally add a lightweight image validation/resizing step during admin upload workflow.

5. Add a few trust details without clutter.
   Pickup policy
   return/refund policy
   contact email or contact page

## Operations

1. Create a deployment runbook for the Hetzner path.
   Include server creation choices, SSH setup, firewall, system packages, Git
   deploy, `.env` creation, systemd service, Caddy config, DNS, HTTPS check,
   backup location, and rollback/restart commands.

2. Add automated tests for critical paths.
   Basket add/update/remove
   pickup order submission
   order lookup
   admin product editing
   admin order transitions
   archive/restore flow

3. Add backup and restore verification.
   Backup exists already.
   Need a documented restore drill and periodic verification.

4. Add better operational logging.
   Keep request logging simple.
   Add clearer error logging for pickup-order failures.

5. Add a short release checklist.
   Restart service
   verify homepage
   verify pickup order submission
   verify admin login
   verify backups

## Probably Not Needed

Avoid these unless there is a strong business reason:

- mandatory customer accounts
- recommendations/personalization
- analytics scripts
- heavy client-side frameworks
- complex marketing popups
- feature creep in the storefront

## Suggested Next Implementation Order

1. Pay-at-pickup order status workflow
2. Back-in-stock notification queue
3. Better out-of-stock and cart feedback
4. Low-stock visibility in admin
5. Tests for the critical paths
6. Stronger admin authentication
7. Order emails
8. Tax/business-rule review if the store becomes active beyond informal local sales
9. Stripe Checkout integration only if the store is ready to become real ecommerce
10. Webhook-based order payment confirmation
