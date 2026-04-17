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

- no customer accounts
- no third-party tracking
- no SPA/frontend build pipeline
- no unnecessary external services

External services are acceptable when they solve a real store need with minimal complexity, such as payments or transactional email.

## Highest Priority

1. Add real payment processing.
   Use Stripe Checkout first, not a custom card form.
   Only mark an order as paid after webhook confirmation.
   Update checkout flow so unpaid orders are not treated as completed orders.

2. Add production-safe admin auth.
   Replace the single shared password with something safer for an internet-facing store.
   Minimum acceptable path: hashed password, rate limiting, and better session handling.

3. Add shipping and tax handling.
   Shipping is currently zero.
   Add simple configurable shipping rules first.
   Add tax handling that matches the deployment location.

4. Add order emails.
   Customer should receive an order confirmation.
   Store owner should receive a new-order notification.

5. Finish public deployment setup.
   Replace placeholder domain in `Caddyfile`.
   Point DNS to the server.
   Confirm HTTPS, secure cookies, and service restart flow.

## Admin Improvements

1. Improve order board workflow.
   Archive cancelled orders is now supported.
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

2. Add better empty and unavailable states.
   Clear out-of-stock handling
   clear search no-results messaging
   better cart feedback when stock changes

3. Improve image handling.
   Use consistently sized local images.
   Optionally add a lightweight image validation/resizing step during admin upload workflow.

4. Add a few trust details without clutter.
   Shipping policy
   return/refund policy
   contact email or contact page

## Operations

1. Add automated tests for critical paths.
   Cart add/update/remove
   checkout
   order lookup
   admin product editing
   admin order transitions
   archive/restore flow

2. Add backup and restore verification.
   Backup exists already.
   Need a documented restore drill and periodic verification.

3. Add better operational logging.
   Keep request logging simple.
   Add clearer error logging for payment and order failures.

4. Add a short release checklist.
   Restart service
   verify homepage
   verify checkout
   verify admin login
   verify backups

## Probably Not Needed

Avoid these unless there is a strong business reason:

- customer accounts
- recommendations/personalization
- analytics scripts
- heavy client-side frameworks
- complex marketing popups
- feature creep in the storefront

## Suggested Next Implementation Order

1. Stripe Checkout integration
2. webhook-based order payment confirmation
3. shipping/tax rules
4. order emails
5. stronger admin authentication
6. admin order search/filter
7. tests for the critical paths
