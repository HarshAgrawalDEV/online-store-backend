# Phase 3 — Customer Authentication & Shopping Management

Date: 2026-10-02

## Outcome

Phase 3 is complete on the existing Payload CMS modular monolith. Customers can register and authenticate with email/password, manage their profile and Indian addresses, maintain a product wishlist and authenticated variant cart, and preview validated coupons with server-authoritative integer-paise pricing.

Internal administrator authentication remains separate. No customer web pages, React Native code, OTP/SMS integration, guest cart, checkout, order, payment, shipping, inventory reservation, or permanent coupon redemption was added. No Git commit or push was performed.

## Collections

| Collection | Purpose |
|---|---|
| `customers` | Payload auth collection with names, unique email, optional normalized Indian phone, independent verification flag, active/suspended status, login lockout, sessions, and last login |
| `customer-addresses` | Owner-linked Indian addresses with state/UT code, PIN validation, address type, soft deletion, and one active default |
| `wishlists` | One primary “Saved Items” container per customer |
| `wishlist-items` | Unique wishlist/product references; product data remains current rather than copied |
| `carts` | One active INR cart per authenticated customer, optionally linked to a coupon |
| `cart-items` | Unique cart/variant lines with positive integral quantities |
| `promotions` | Internal discount definition, active window, percent/fixed value, cap, and product/category eligibility |
| `coupons` | Unique normalized code, promotion link, active window, minimum cart, and future redemption limits |

Order-linked `coupon-redemptions` remain deferred to Phase 4 because applying a code to a cart is not a redemption and no order entity exists yet.

## Authentication architecture

- `admins` remains the only Payload Admin identity (`admin.user = 'admins'`).
- `customers` uses Payload-native hashing, login, session/JWT, logout, and current-user behavior.
- Direct public customer creation is denied; `POST /api/customer-auth/register` validates and allow-lists input before using Payload Auth.
- Passwords require 10–128 characters with uppercase, lowercase, and a number.
- Five failed attempts lock login for 15 minutes. Tokens expire after seven days.
- Suspended customers are rejected at login and on subsequent custom API requests, including when suspension occurs after token issuance.
- Customer profile writes cannot change email, status, phone verification, auth internals, or owner IDs.
- Customer collection Admin access is staff-only; a customer token resolves to `user: null` against `/api/admins/me`.

React Native should store the returned token in platform-backed Keychain/Keystore storage and send:

```http
Authorization: JWT <token>
```

After logout/expiration, Payload's native `GET /api/customers/me` returns HTTP 200 with `user: null`; the app must interpret that as signed out.

## API endpoints

### Authentication and profile

- `POST /api/customer-auth/register`
- `POST /api/customers/login` (Payload native)
- `POST /api/customers/logout` (Payload native)
- `GET /api/customers/me` (Payload native)
- `PATCH /api/customers/me`
- `POST /api/customer-auth/change-password`

Example registration:

```json
{
  "firstName": "Asha",
  "lastName": "Sharma",
  "email": "asha@example.com",
  "password": "StrongPassword2026"
}
```

### Addresses

- `GET /api/addresses`
- `POST /api/addresses`
- `GET /api/addresses/default`
- `PATCH /api/addresses/:id`
- `DELETE /api/addresses/:id`
- `PATCH /api/addresses/:id/set-default`

Example body:

```json
{
  "recipientName": "Asha Sharma",
  "phoneNumber": "9876543210",
  "line1": "12 Johari Bazaar",
  "city": "Jaipur",
  "stateCode": "RJ",
  "pincode": "302001",
  "addressType": "home",
  "isDefault": true
}
```

### Wishlist

- `GET /api/wishlist?page=1&limit=20`
- `GET /api/wishlist/check/:productId`
- `POST /api/wishlist/items` with `{ "productId": 1 }`
- `DELETE /api/wishlist/items/:productId`

### Cart and coupons

- `GET /api/cart`
- `POST /api/cart/items` with `{ "variantId": 1, "quantity": 2 }`
- `PATCH /api/cart/items/:itemId` with a positive `quantity`, or `action: increase|decrease`
- `DELETE /api/cart/items/:itemId`
- `DELETE /api/cart`
- `POST /api/cart/apply-coupon` with `{ "code": "WELCOME10" }`
- `DELETE /api/cart/coupon`

Pricing responses use `currency: INR`, `amountUnit: paise`, current variant prices, line totals, subtotal, discount, and estimated total. Applicable product/category rules and percentage caps are evaluated server-side. Totals cannot become negative.

## Integrity and access control

- Owners are always derived from the authenticated request; frontend customer IDs are ignored.
- Customer-owned collection writes are unavailable through generic public CRUD endpoints; audited custom services perform allow-listed operations.
- Cross-customer address/item access returns not found.
- Wishlist `(wishlist, product)` and cart `(cart, variant)` rows are unique.
- Duplicate cart variants consolidate into one line.
- Only active products/variants can be added, variants must match any supplied product ID, maximum-per-order applies, and current available inventory is checked.
- Adding to cart never changes `onHand` or `reserved` inventory.
- Database constraints enforce one active default address/customer, one active cart/customer, PIN format, positive integral quantities, and valid promotion/coupon numeric values.
- Coupon definitions are staff-managed only. A zero configured usage/per-customer limit is rejected. Actual usage counts require Phase 4 order-linked redemptions.

## Password recovery limitation

Authenticated password change is implemented and verifies the current password. Payload's reset-token primitives are configured with a one-hour lifetime and request throttling, but usable forgot/reset delivery is intentionally blocked operationally because no transactional email provider exists. The console email adapter must not be treated as customer delivery, and reset tokens are never returned by custom APIs.

Configure and approve an email provider in a future phase before exposing password recovery in production.

## Future OTP compatibility

Shopping records reference stable customer IDs, never email or phone. Phone is optional, normalized independently, and defaults to unverified. Phase 3 never marks it verified or merges identities. A future OTP service can add verified phone linking while preserving email/password login; OTP challenges, SMS providers, and endpoints were deliberately not created.

## Migrations and seed

- `20261002_101603_phase_3_customer_shopping` adds the eight Phase 3 collections and Payload relationships.
- `20261002_102000_phase_3_invariants` adds database-level partial unique indexes and checks.

During local application, Payload executed the generated DDL before an uncast enum predicate in the original invariant tail failed, without recording the migration. The full generated schema was audited through its final relationship index and safely baselined as batch 3; the corrected, explicitly cast invariant migration then applied as batch 4. No Phase 1/2 table or record was deleted or reset.

The idempotent development seed now includes active `WELCOME10`: 10% discount, maximum ₹500, minimum cart ₹1,000. It does not seed customer credentials.

## Verification results

| Check | Result |
|---|---|
| Type generation and strict TypeScript | Passed |
| Unit and PostgreSQL integration tests | Passed: 5 files, 26 tests |
| Registration / duplicate / invalid credentials | Passed: success, 409, and 401 respectively |
| Login / current user / logout | Passed; logout returns native `user: null` behavior |
| Suspended login and existing-token request | Passed: 401 |
| Profile allow-list / phone normalization | Passed; unsafe status assignment returns 403 |
| Address CRUD/default and cross-owner protection | Passed; unique default and cross-owner 404 verified |
| Wishlist add/dedupe/check/remove | Passed |
| Cart add/consolidate/update/decrease/clear | Passed |
| Invalid quantity / insufficient stock | Passed: 400 / 422 |
| Coupon apply/remove and capped pricing | Passed |
| Customer catalog write | Denied: 403 |
| Customer against admin auth collection | `user: null`; no admin identity established |
| Test data cleanup | Passed; known-password verification accounts removed |

## Phase 4 prerequisites

- Orders and immutable price/address snapshots.
- Transaction-safe inventory reservations with expiry/release.
- Order-linked coupon redemptions and real global/per-customer usage counts.
- Checkout quotation, delivery fees, payment attempts, and idempotency.
- Approved email adapter for password recovery; OTP/SMS only after a provider and account-linking policy are approved.
