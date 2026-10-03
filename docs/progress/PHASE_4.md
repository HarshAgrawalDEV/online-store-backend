# Phase 4 — Checkout, Orders, Reservations, and Payments

Date: 2026-10-03

## Outcome

Phase 4 implements server-authoritative checkout, immutable order snapshots, transaction-safe stock reservations, COD allocation, coupon redemption, controlled order transitions, Razorpay integration contracts, cryptographic callback verification, idempotent webhooks, payment retries, customer order APIs, and Payload Admin commerce views.

No React Native UI, shipping-provider integration, refund/return workflow, deployment, Git commit, or Git push was performed.

## Persistent models

| Model                    | Purpose                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `orders`                 | Canonical totals, address/pricing snapshots, public reference, state projections, and customer-scoped idempotency |
| `order-items`            | Immutable product, SKU, option, quantity, and price snapshots                                                     |
| `order-status-events`    | Append-only business/audit timeline                                                                               |
| `inventory-reservations` | Per-order, per-variant active/committed/released/expired holds                                                    |
| `payment-attempts`       | Every COD or gateway attempt and safe failure state                                                               |
| `payment-webhook-events` | Signature result and provider-event idempotency ledger                                                            |
| `coupon-redemptions`     | Allocated/redeemed/released order-linked coupon usage                                                             |
| `shipping-settings`      | Payload Global for the temporary development shipping/COD policy                                                  |

Generic creates, updates, and deletes for financial collections are denied. Active staff can inspect them in Payload Admin; state changes go through services and controlled endpoints.

## Migration

`20261003_060603` creates the Phase 4 tables, relationships, indexes, enum types, nullable `carts.convertedOrder`, and database checks for positive integral quantities, nonnegative money, reconciled order totals, positive payment amounts, and `0 <= reserved <= onHand`.

The migration is additive and generated against the existing schema. Local application is pending explicit approval because Payload detected its development-push marker and displayed a concrete data-loss confirmation warning. The warning was not bypassed. Back up/audit the local database before explicitly approving that prompt.

## Checkout and pricing

`POST /api/checkout/preview` validates the active customer, owned active address, nonempty active cart, current product/variant states, max quantities, inventory, coupon windows/eligibility/usage limits, payment method, COD policy, and serviceability mode. It returns current integer-paise prices and does not mutate commerce state.

Shipping comes from `shipping-settings`: standard fee, free-shipping threshold, COD flag/fee, and handling days. `development_all_india` is a clearly labelled local fallback, not carrier confirmation. Tax is currently zero with an explicit `productionReady: false` marker; production tax rules remain unconfigured.

## Placement and idempotency

`POST /api/checkout/place-order` accepts `addressId`, `paymentMethod`, optional `couponCode`, and an 8–120 character `idempotencyKey`. The server derives customer, cart, products, prices, quantities, discounts, fees, and totals.

`(customer, idempotencyKey)` is unique and the normalized checkout choices are SHA-256 hashed. Same-key/same-payload retries return the original order; same-key/different-payload returns 409. The cart and source order are also uniquely linked.

The transaction creates the order, immutable items, reservations, coupon allocation, payment attempt, audit event, and converted-cart link. No provider network call runs inside it.

## Inventory concurrency

Each SKU reservation uses an atomic PostgreSQL conditional update:

```sql
UPDATE inventory
SET reserved = reserved + $quantity
WHERE variant_id = $variant
  AND stock_status = 'available'
  AND on_hand - reserved >= $quantity
RETURNING id;
```

Failure rolls back every SKU and order record. Commit changes both `onHand` and `reserved` once and writes a movement. Release changes only `reserved`. Cancellation of committed COD inventory restocks `onHand` once. Expiry uses row locks with `SKIP LOCKED`; all terminal operations claim the prior reservation state conditionally.

## Order and COD lifecycle

Order statuses follow the workbook: `pending_payment`, `confirmed`, `processing`, `packed`, `shipped`, `delivered`, `cancelled`, `returned`. Payment and fulfillment remain independent projections.

COD is confirmed but unpaid. Its reservation is immediately committed so ordinary payment-pending logic cannot release it. Eligible unpaid cancellation reverses the allocation. Recording collected COD and carrier remittance remains Phase 5.

## Razorpay and payment lifecycle

The provider abstraction implements backend order creation, checkout HMAC verification, webhook HMAC verification, and payment fetch. Amount and currency are always server values. Verified success requires a captured Razorpay payment whose provider order ID, amount, and currency match the stored attempt.

Required configuration:

```dotenv
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
INVENTORY_RESERVATION_MINUTES=15
```

Credentials are currently absent. COD and previews remain available; normal online initialization returns `PAYMENT_PROVIDER_NOT_CONFIGURED` before mutation. No live/test Razorpay request or payment was claimed as verified.

When credentials become available, use Razorpay Test Mode keys, configure the webhook URL `/api/payments/webhooks/razorpay`, subscribe at least to captured/failed payment events, ensure capture settings produce `captured` payments, and run an end-to-end test-mode transaction.

## Failure, retry, and webhook behavior

- Gateway timeout/unknown creation outcome remains pending and retains stock until reconciliation or expiry.
- Failed provider payment does not release inventory immediately.
- Eligible retry uses the exact stored payable amount and does not create another order.
- An uncertain attempt without a provider order ID blocks another charge attempt.
- Duplicate webhooks return safely; supported captured/failed events share idempotent state logic.
- A captured payment after expiry is recorded but routed to `LATE_PAYMENT_REQUIRES_RECONCILIATION` without falsely confirming stock.

## Coupon strategy

Preview checks current limits. Placement locks the coupon row and counts both allocated and redeemed usage inside the order transaction. Online checkout allocates, verified capture redeems, and failure/cancellation/expiry releases. COD redeems when the accepted order commits inventory. Each order has at most one redemption.

## APIs

| Method | Path                                       | Access                                          |
| ------ | ------------------------------------------ | ----------------------------------------------- |
| POST   | `/api/checkout/preview`                    | Active customer                                 |
| POST   | `/api/checkout/place-order`                | Active customer                                 |
| GET    | `/api/orders?page=1&limit=20`              | Active customer, own orders                     |
| GET    | `/api/orders/:id`                          | Active customer, own order                      |
| POST   | `/api/orders/:id/cancel`                   | Active customer, eligible own order             |
| POST   | `/api/orders/:id/retry-payment`            | Active customer, eligible own order             |
| POST   | `/api/payments/verify`                     | Active customer, owned attempt                  |
| POST   | `/api/payments/webhooks/razorpay`          | Razorpay HMAC                                   |
| POST   | `/api/admin/orders/:id/status`             | Active super admin/order manager                |
| POST   | `/api/admin/inventory-reservations/expire` | Active super admin/order manager/scheduler call |

Placement example:

```json
{
  "addressId": 1,
  "paymentMethod": "cod",
  "couponCode": "WELCOME10",
  "idempotencyKey": "mobile-checkout-a4f0b6d2"
}
```

Payment verification example:

```json
{
  "razorpayOrderId": "order_...",
  "razorpayPaymentId": "pay_...",
  "razorpaySignature": "..."
}
```

## Verification status

| Check                                        | Result                                      |
| -------------------------------------------- | ------------------------------------------- |
| Generated Payload types                      | Passed                                      |
| Strict TypeScript                            | Passed                                      |
| Phase 4 isolated unit tests                  | Passed: 10 tests                            |
| Migration generation/status                  | Passed; Phase 4 migration is pending        |
| PostgreSQL integration/concurrency suite     | Pending migration approval                  |
| Full Phase 1–3 regression, lint, build/start | To be run after migration state is resolved |

Unit coverage currently includes preview totals, invalid address, insufficient stock, unsupported method, monetary rounding, valid/invalid checkout HMAC, raw-body webhook HMAC, missing-provider fail-safe behavior, and invalid order transitions.

## Known limitations and Phase 5 prerequisites

- Apply the pending migration after a verified backup and explicit approval of Payload's dev-marker warning.
- Configure Razorpay Test Mode credentials and perform provider-backed verification.
- Replace development serviceability with carrier pincode/COD checks.
- Finalize product-specific GST/tax policy.
- Schedule reservation expiry through the deployment scheduler or add approved Payload Jobs scheduling.
- Phase 5 should add shipments/tracking, fulfillment-side COD collection, notifications, and a separately authorized refund/return workflow.
