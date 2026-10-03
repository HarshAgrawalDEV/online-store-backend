# Phase 4.5 — Backend verification, integration testing and hardening

Date: 2026-10-03. Scope: Phases 1–4 of the backend, verified **from the mobile app's point of view**. No Phase 5 work, no deployment, no real payment gateway calls.

## 1. Outcome

The backend is now covered by 90 automated end-to-end tests that drive **the mobile app's own API client, services and mappers** (`mobile/src/api`) against the real Payload handlers and a real PostgreSQL database, plus 62 database-free unit tests. Doing this found and fixed **27 defects**, several of which would have broken the app for every customer (the order history, order details, cancel and Pay-now calls could not work at all in the previous build).

Not claimed: real Razorpay integration (no credentials), behaviour under load, the Admin UI in a browser, and a dependency vulnerability audit. See sections 7 and 8.

## 2. How the tests were built

`backend/tests/e2e` contains a harness that:

- imports the mobile app's API layer directly (`@mobile/src/api/client`, `services/*`, `mappers`, `tokenStore`, resolved to a mobile checkout at `../mobile` or `MOBILE_APP_DIR`) with tiny Node stand-ins for React Native, the keychain and `@env`;
- routes every `fetch` the app makes into Payload's real REST handlers (custom endpoints, auth, access control, hooks) with a real database, so a backend change that would break the app fails a test;
- replaces `api.razorpay.com` with a controlled fixture (creates gateway orders, returns payments, signs checkout and webhook payloads, can simulate an outage). **This proves our handling of gateway responses, not a live Razorpay integration.**

Safety: the harness refuses to run unless the database name ends in `_test` (`TEST_DATABASE_URL`) or `E2E_ALLOW_SHARED_DB=true` is set. Every row it creates carries an `e2e` prefix and is removed afterwards by prefix; it also clears leftovers from interrupted runs. The final database counts were all zero and shipping settings were restored.

A separate check started the **production build as a real server** and probed it over HTTP (section 6).

## 3. Findings and fixes

Severity: **Critical** breaks core purchase flow or exposes the system; **High** security or money/stock integrity; **Medium** incorrect behaviour; **Low** hygiene/consistency.

| # | Sev | Finding (how it was found) | Fix |
|---|---|---|---|
| 1 | Critical | **Customer order routes were unreachable.** `/api/orders…` clashes with Payload's own staff-only route for the `orders` collection, so history, details, cancel and retry-payment returned "not allowed" or "route not found" for customers (found by Flow A through the app's order service). | Customer routes moved to `/api/my-orders…` (matches the planning spreadsheet). App, tests, docs updated. |
| 2 | Critical | **Anyone could create the first super-administrator** whenever the admin table was empty. | Anonymous bootstrap closed in production unless `ALLOW_ADMIN_BOOTSTRAP=true`; added `pnpm create-admin`. |
| 3 | High | **Development database was built by schema auto-sync**: the Phase 4 migration was unapplied, migration history was out of step, and **no CHECK constraints existed** (negative or oversold stock was possible). | With your approval: backup taken, schema reset, all 5 migrations replayed from scratch (11 CHECK constraints now present), development auto-sync disabled (`push: false`). |
| 4 | High | Every staff role could read and change customer accounts, carts and security fields; supplier cost visible to all staff. | Role/permission matrix (`access/permissions.ts`); customer email/password/status restricted; shopping records writable only through services. |
| 5 | High | Wishlist responses returned raw documents with privileged reads (cost price, internal fields). | Allow-listed response; catalog read with normal access rules. |
| 6 | High | No rate limiting; GraphQL left on and unthrottled. | In-process limiter on register, login/recovery, change-password, coupon, checkout, catalog, admin and webhook routes (429 + `Retry-After`); GraphQL disabled. |
| 7 | High | **Stock adjustments lost updates under concurrency** (adjusting +5, +7, −3 from 10 ended at 7, not 19), could drive stock negative, and a retried request applied twice. | Adjustments serialised by row locks; optional `operationId` makes retries idempotent; conflicting reuse returns 409; history always sums to stock. |
| 8 | High | **Cart lost updates**: six rapid "Add to bag" taps ended with quantity 2; parallel first cart/wishlist access returned HTTP 500. | Cart changes run under a cart row lock; get-or-create retries after a unique-constraint race; wishlist duplicate taps treated as already saved. |
| 9 | High | An unpaid online order whose stock hold expired **stayed `pending_payment`**: shown with Pay now, which could never succeed, and the coupon stayed allocated. | Expiry now cancels the order, records the event, and frees stock and coupon. |
| 10 | High | The app would **sign the customer out for ordinary mistakes**: wrong current password and bad payment signature returned HTTP 401, which the app treats as an expired session. | Those return 400 (`INVALID_CURRENT_PASSWORD`, `INVALID_PAYMENT_SIGNATURE`); the app now signs out only on `AUTHENTICATION_REQUIRED`. |
| 11 | Medium | Order and checkout-preview responses returned raw stored documents (request hash, idempotency key, customer/cart ids, pricing internals, **staff notes in the timeline**). | Allow-listed serializers; staff-authored reasons are not shown to customers. |
| 12 | Medium | **Order items did not store the product image**, so purchase history showed placeholders. | Image snapshotted at purchase. |
| 13 | Medium | Cancel returned a bare order without items, which would blank the app's order screen. | Cancel returns the full order. |
| 14 | Medium | A webhook for an unknown gateway order returned 404, so the gateway would retry forever. | Acknowledged and ignored. |
| 15 | Medium | After a gateway outage during checkout the order could **never be paid** (retry blocked as "uncertain"). | The abandoned attempt is closed and a clean one is created; the app opens the order with Pay now. |
| 16 | Medium | **No scheduled job** released expired holds, and a captured payment whose callback and webhook were both lost was never settled. | Maintenance loop every 60 s (expire holds, reconcile open gateway attempts through the gateway), plus `POST /admin/maintenance/run`. |
| 17 | Medium | Payment-attempt idempotency key was global: a second customer reusing a key got a 500. | Key namespaced per customer. |
| 18 | Medium | Coupons: a coupon covering none of the cart's products was reported as applied; usage limits were enforced only at purchase. | Refused at apply (`INELIGIBLE_COUPON`); per-customer and global limits checked at apply and again under lock at purchase. |
| 19 | Medium | Verify and webhook arriving together could write duplicate events. | Order row lock inside payment finalisation; cancel and staff transitions also locked. |
| 20 | Medium | Malformed JSON returned 500; some routes returned 400 to anonymous callers instead of 401. | 400 `INVALID_JSON`; authentication is checked before validation. |
| 21 | Medium | Variants of unpublished products were visible through Payload's REST routes. | Public variant read requires an active parent product. |
| 22 | Low | Catalog errors used a different shape; clear-cart returned a different shape. | One error envelope everywhere; clear-cart returns the cart. |
| 23 | Low | Coupon allocation ran parallel queries on one transaction connection (breaks with `pg` 9). | Sequential queries; the deprecation warning is gone. |
| 24 | Perf | Cart pricing ran about three queries per line; catalog listings fetched up to 500 products and paged in memory. | Two batched reads per cart; default listings paginated by the database. |
| 25 | Low | `backups/` (database dumps with role password hashes) was not gitignored; `X-Powered-By` advertised the framework. | Ignored; header disabled. |
| 26 | Test safety | The old Phase 3 integration suite wrote to the configured database with no guard. | Excluded from the default run; database suites run only through `test:e2e` with the safety guard. |
| 27 | Docs | Planning documents mention paths and entities that differ from the build. | See section 8. |

Status of the earlier `BACKEND_PRODUCTION_REVIEW.md` findings: **fixed** R01, R02, R03, R04, R05, R08, R11, R16, R18, R21 (guard), R24; **partly** R06 (default listing paginated; price sort and variant filters still bounded to 500), R07 (cart marks unavailable lines; stock is re-checked at preview and purchase), R20, R22 (migration replay proven; seed can still overwrite content); **open** R09 (variant re-parenting), R10, R12, R13, R14 (default-address race under concurrency not tested), R15, R17, R19, R23, R25.

## 4. Files changed

Backend source: `access/{permissions,catalog,commerce,customers,admins}.ts`; `collections/{Admins,Customers,Carts,CartItems,Wishlists,WishlistItems,CustomerAddresses,ProductVariants}.ts`; `endpoints/{commerce,catalog,inventory}.ts`; `hooks/inventory.ts`; `jobs/maintenance.ts` (new); `scripts/create-admin.ts` (new); `lib/{rate-limit,api-response}.ts`; `services/{addresses,cart,catalog-query,customer-auth,inventory,pricing,wishlist}.ts`; `services/checkout/pricing.ts`; `services/coupons/redemptions.ts`; `services/inventory/reservations.ts`; `services/orders/order-service.ts`; `services/payments/{payment-provider,payment-service,razorpay.provider}.ts`; `payload.config.ts`; `next.config.ts`.

Configuration and docs: `package.json` (`test:e2e`, `create-admin`), `vitest.config.mts`, `vitest.e2e.config.mts` (new), `tsconfig.json`, `.env.example`, `backend/README.md`, `.gitignore`, `docs/api/MOBILE_API_REFERENCE.md` (new), this file.

Tests: new `tests/permissions.spec.ts`, `rate-limit.spec.ts`, `wishlist-response.spec.ts`, and 13 files under `tests/e2e` (harness, mobile driver, helpers, stubs, 10 suites); updated `admin-access.spec.ts`, `phase4-unit.spec.ts`.

Mobile (to match the backend): `src/api/client.ts` (sign out only on authentication failures), `src/api/services/orders.ts` (`/my-orders`), `src/hooks/data/useCheckout.tsx` (unpaid online order opens Pay now), `__tests__/api.test.ts`.

## 5. Database changes

- **No schema change and no new migration.** The existing five migrations are unchanged.
- The development database was **reset with your approval** after a full backup (`backups/jewelry_ecommerce-before-phase45-reset.sql`, 41 tables) and rebuilt only from the migrations. This removed the 5 seed products and the single admin that existed. Restore them with `pnpm seed` and `pnpm create-admin`.
- Verified on the rebuilt schema: 5 migrations recorded (no `dev` marker), 11 CHECK constraints, and the unique indexes for idempotency, SKU, one active cart and one default address per customer, wishlist and cart-line uniqueness, coupon code and order number. PostgreSQL rejected every impossible write attempted in the tests (negative or over-reserved stock, fractional paise, mismatched order totals, zero quantity, duplicates, dangling foreign keys).
- Development auto-sync is disabled in `payload.config.ts`.

## 6. Tests executed and results

| Check | Result |
|---|---|
| Backend TypeScript (`tsc --noEmit`) | **Pass** |
| Backend ESLint | **Pass** (0 warnings) |
| Prettier format check | **Pass** |
| Backend unit tests (8 files) | **Pass: 62 / 62** |
| End-to-end tests (10 suites) | **Pass: 90 / 90** on the final full run |
| Database migration replay on an empty schema | **Pass** (5 of 5) |
| Production build (`next build`) | **Pass** |
| Built server probed over real HTTP | **Pass**: health 200; catalog 200 and bad limit 400; signed-out cart and `/my-orders` 401; staff-only `/orders` 403; GraphQL 404; malformed JSON 400; unsigned webhook 401 |
| Mobile TypeScript, ESLint, Jest | **Pass: 19 / 19** |

End-to-end coverage: COD purchase (Flow A); online payment success, forged signature, wrong amount, duplicate and unknown webhooks, gateway outage (Flow B); failed payment and retry, hold expiry, late payment (Flow C); concurrent checkout (Flow D: last unit by COD and online, 8 customers for 3 units, double-tapped Place order, single-use coupon race, verify racing webhook, concurrent cancels, expiry racing payment); cross-customer access (Flow E: addresses, wishlist, cart, orders, payments, built-in Payload routes, staff routes); authentication, sessions, lockout, mass assignment, input and error safety, rate limiting; catalog visibility and search; cart and coupon rules; delayed payment reconciliation; database integrity; response contracts.

Observations to be aware of:
- In one of four full end-to-end runs a suite's setup hook timed out after 180 s; the same suite passed alone, in pairs, and in the full runs that followed. I could not reproduce it or find a leaked lock (no open transactions afterwards), so it is recorded as an unexplained transient.
- One mobile Jest run reported a single failure that did not repeat in four later runs (19 / 19 each time); the test was not identified.

## 7. Not executed or blocked

- **Real Razorpay**: no credentials were available. Signature checks, webhooks and reconciliation are verified against a controlled fixture only. A Test Mode run is still required.
- **Disposable test database**: the application database role cannot create databases, so the suite ran against the development database using only tagged rows it deletes afterwards. Create `jewelry_ecommerce_test` (see `.env.example`) and set `TEST_DATABASE_URL` to remove that compromise.
- **Admin UI in a browser**: customers' inability to use the Admin was verified through the API (customer tokens rejected by the admin login and endpoints, no admin session) and unit tests, not in a browser.
- **Load testing, backup restoration drill, dependency vulnerability audit**: not run.
- **Reconciliation of the schema against the planning spreadsheet**: only the entity list and API list were compared (below); a field-by-field check was not done.
- The harness calls Payload's request handlers directly. The real-HTTP probe above covers routing, but body-size limits, proxy headers and TLS are untested.

## 8. Remaining limitations

Not defects in this phase's scope, but required before the matching capability is exposed:

- **Paid-order cancellation, refunds and returns** are not implemented (`REFUND_REQUIRED`). A payment that arrives after the hold expired is flagged for manual reconciliation (`paymentUnderReview`), not automatically refunded or re-reserved.
- **Password recovery** cannot deliver email (no email adapter); phone-OTP login from the plan is not built (email and password is used).
- **Tax is zero and delivery serviceability is a development fallback** (all of India); both are labelled not production-ready in API responses.
- **Media** is stored on local disk (breaks with ephemeral or multiple instances).
- **Rate limits are per server instance**; use a shared store before running several instances.
- **No general audit log** of staff changes (stock movements and order events exist).
- Planning-spreadsheet MVP entities not built, outside Phases 1–4: `home-sections`, `site-settings`, `otp-challenges`, `customer-notifications`, shipments and shipment events, guest carts. The spreadsheet lives at `docs/Rajasthan_Jewelry_PayloadCMS_Database_Schema.xlsx` (the brief said `docs/database/`).
- Price sorting and variant filters in the catalog still examine at most 500 matching products.
- Open items from the earlier review listed in section 3.

## 9. External integration blockers

1. Razorpay Test Mode keys, webhook URL and secret; then a real end-to-end transaction.
2. A transactional email provider (password reset, order emails).
3. An object-storage provider for media, and a public `NEXT_PUBLIC_SERVER_URL` (media URLs in responses are absolute).
4. A shipping carrier or serviceability source, and the business tax rules.
5. A hosting plan that runs the long-lived Node process (the maintenance loop needs it) and a production database with backups.

## 10. Readiness for React Native integration

**Ready for staging integration**, with the mobile app already wired to these APIs. The customer API is documented in `docs/api/MOBILE_API_REFERENCE.md` and every documented call is exercised by the mobile-driven suites. Before real customers: complete the Razorpay Test Mode run, set the production environment values (`API_BASE_URL` in `mobile/.env`, `NEXT_PUBLIC_SERVER_URL`, `TRUSTED_PROXY_HOPS`), create the first administrator with `create-admin`, and resolve the blockers in section 9.
