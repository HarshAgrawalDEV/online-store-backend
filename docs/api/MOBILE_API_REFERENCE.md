# Mobile API reference

Customer-facing REST API used by the React Native app. Every endpoint below is exercised by the end-to-end suite in `backend/tests/e2e`, which drives the app's own API client (`mobile/src/api`) against the real handlers and PostgreSQL. Examples are real responses captured from that suite.

- **Base URL:** `{API_BASE_URL}/api` (the app reads `API_BASE_URL` from `mobile/.env`).
- **Money:** always **integer paise** (`amountUnit: "paise"`). Never floats. Prices come from the server; the app never sends them.
- **Ids:** numeric in JSON. The app stores them as strings.
- **Dates:** ISO 8601 UTC strings.

## Authentication

Customers sign in with Payload's native login and send the returned token on every authenticated request:

```
Authorization: JWT <token>
```

- Tokens last 7 days. Store them only in the platform Keychain/Keystore.
- **Only an HTTP 401 with `error.code: "AUTHENTICATION_REQUIRED"` means "signed out".** The app ends the session on that and nothing else. Mistakes in user input (wrong current password, bad payment signature, invalid coupon) never return 401.
- `GET /customers/me` answers **200** with `"user": null` when the token is missing, expired, or logged out. Treat that as signed out.
- Five wrong passwords lock the account for 15 minutes (login then fails with 401 until the lock ends).

## Response formats

| Kind | Used by | Shape |
|---|---|---|
| Envelope success | everything custom except catalog | `{ "success": true, "data": …, "message": "…" }` |
| Envelope error | everything custom, including catalog | `{ "success": false, "error": { "code": "…", "message": "…" } }` |
| Raw document | `GET /catalog/*` success, and Payload's own login/logout/me | the document itself |
| Payload native error | Payload's own routes (login, built-in collections) | `{ "errors": [ { "message": "…" } ] }` |

The app client unwraps envelopes automatically and maps all error shapes to one `ApiError { code, message, status }`.

## Status codes and error codes

| Status | Meaning | Codes you will see |
|---|---|---|
| 400 | The request is malformed or fails validation | `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_IDEMPOTENCY_KEY`, `INVALID_CURRENT_PASSWORD`, `INVALID_PAYMENT_SIGNATURE` |
| 401 | Not authenticated | `AUTHENTICATION_REQUIRED` |
| 403 | Authenticated but not allowed | `FORBIDDEN`, `FORBIDDEN_FIELD` (body contained a field customers may not set) |
| 404 | Not found, or not yours | `NOT_FOUND`, `ORDER_NOT_FOUND`, `PAYMENT_ATTEMPT_NOT_FOUND` |
| 409 | Conflicts with current state | `ACCOUNT_EXISTS`, `INSUFFICIENT_STOCK` (checkout), `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_MISMATCH`, `PAYMENT_NOT_CAPTURED`, `PAYMENT_RETRY_NOT_ALLOWED`, `RESERVATION_EXPIRED`, `REFUND_REQUIRED`, `INVALID_ORDER_TRANSITION`, `COUPON_LIMIT_REACHED` (if lost in a race at checkout) |
| 422 | Valid request the business rules refuse | `UNAVAILABLE_VARIANT`, `UNAVAILABLE_PRODUCT`, `UNAVAILABLE_ITEM`, `MAX_QUANTITY_EXCEEDED`, `INSUFFICIENT_STOCK` (cart), `INVALID_COUPON`, `COUPON_EXPIRED`, `MINIMUM_CART_NOT_MET`, `INELIGIBLE_COUPON`, `COUPON_LIMIT_REACHED`, `COUPON_CUSTOMER_LIMIT_REACHED`, `UNSUPPORTED_PAYMENT_METHOD`, `COD_UNAVAILABLE`, `DELIVERY_UNAVAILABLE`, `VARIANT_PRODUCT_MISMATCH` |
| 429 | Rate limited; honour the `Retry-After` header (seconds) | `RATE_LIMITED` |
| 502 / 503 | Payment gateway problem or not configured | `PAYMENT_PROVIDER_ERROR`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_PROVIDER_NOT_CONFIGURED` |
| 500 | Unexpected server fault (details are logged, never returned) | `INTERNAL_ERROR` |

Rate limits (per server instance): register 5/hour per address; login and password recovery 10 per 15 min per address; change password 5 per 15 min; coupon apply 10/min; checkout and payments 20/min; catalog 120/min per address; other endpoints 120/min per account.

---

## Account

### `POST /customer-auth/register` — public
```json
{ "email": "asha@example.com", "firstName": "Asha", "lastName": "Sharma", "password": "StrongPassword2026" }
```
`lastName` optional. Password: 10–128 characters with upper case, lower case and a digit. Extra fields (`status`, `role`, `phoneVerified`…) are ignored.
**201** → `data`: `{ id, firstName, lastName, email, phoneNumber, phoneVerified, status, createdAt, updatedAt }`
Errors: `VALIDATION_ERROR` 400, `ACCOUNT_EXISTS` 409.

### `POST /customers/login` — public (Payload native)
`{ "email": "…", "password": "…" }` → **200** `{ "message": "Authentication Passed", "exp": 1791632884, "token": "<jwt>", "user": { id, firstName, lastName, email, phoneNumber, phoneVerified, status, … } }`
Wrong credentials: **401**, identical response for unknown and known emails.

### `POST /customers/logout` — auth
Ends the session; the old token stops working. **200** `{ "message": "Logout successful." }`

### `GET /customers/me` — auth (Payload native)
**200** `{ "user": { … } | null, "token": "…", "exp": … }`

### `PATCH /customers/me` — auth
Body: any of `firstName`, `lastName`, `phoneNumber` (Indian mobile; stored as `+91…`). Any other field → **403** `FORBIDDEN_FIELD`.
**200** → `data`: the customer (same shape as register).

### `POST /customer-auth/change-password` — auth
`{ "currentPassword": "…", "newPassword": "…" }` → **200** `data: { customerId }`.
Wrong current password → **400** `INVALID_CURRENT_PASSWORD`. Weak new password → **400** `VALIDATION_ERROR`.

---

## Catalog — public, cached 60 s, raw documents

### `GET /catalog/products`
Query: `search`, `category` (id), `collection` (id), `color`, `size`, `material`, `occasion`, `minPrice`, `maxPrice` (paise), `available` (`true|false`), `sort` (`newest` default, `name`, `price-low`, `price-high`), `page` (≥1), `limit` (1–50, default 20).

**200**
```json
{
  "docs": [{
    "id": 245, "name": "Dump Bangle", "slug": "…", "shortDescription": "…",
    "primaryCategory": { "id": 1, "name": "Bangles", "slug": "bangles" },
    "featuredImage": { "url": "https://…/api/media/file/a.jpg", "sizes": { "card": { "url": "…" }, "hero": { "url": "…" } } },
    "gallery": [ { "image": { "url": "…" } } ],
    "jewelryDetails": { "material": "…", "plating": "…", "stoneType": "…" },
    "isFeatured": false,
    "priceRange": { "minPaise": 250000, "maxPaise": 250000 },
    "available": true,
    "variants": [{
      "id": 256, "sku": "…", "sizeCode": "free-size", "colorCode": "gold",
      "pricePaise": 250000, "compareAtPricePaise": null, "maxPerOrder": 5,
      "availability": { "available": true, "quantity": 9 }
    }]
  }],
  "page": 1, "limit": 20, "totalDocs": 1, "totalPages": 1, "hasNextPage": false, "hasPrevPage": false
}
```
Only **active** products with **active** variants are returned. Supplier cost is never included. `availability.quantity` is stock that can be bought now (on hand minus reserved).
Errors: **400** `VALIDATION_ERROR` (bad `limit`, `sort`, price range…).

### `GET /catalog/products/:idOrSlug`
**200** one product (same shape, with `description`, `specifications`, full gallery). Unpublished or unknown → **404** `NOT_FOUND`.

---

## Addresses — auth

Address object: `{ id, recipientName, phoneNumber, line1, line2, landmark, city, stateCode, pincode, countryCode: "IN", addressType: "home"|"work"|"other", isDefault, isActive, createdAt, updatedAt }`.
`stateCode` is a two-letter Indian state/UT code (for example `RJ`); `pincode` is six digits not starting with 0; phone is an Indian mobile number.

| Method & path | Notes |
|---|---|
| `GET /addresses` | `data: { docs: [address…], totalDocs, … }`, default first |
| `GET /addresses/default` | `data`: address or `null` |
| `POST /addresses` | Body: `recipientName, phoneNumber, line1, city, stateCode, pincode` required; `line2, landmark, addressType, isDefault, countryCode` optional. **201**. Unsupported fields (`customer`, `isActive`, `id`…) → **403** `FORBIDDEN_FIELD` |
| `PATCH /addresses/:id` | Same fields, all optional. Another customer's id → **404** |
| `DELETE /addresses/:id` | Soft delete. `data: { id, deleted: true }`. Past orders keep their own address copy |
| `PATCH /addresses/:id/set-default` | Exactly one default per customer, switched atomically |

---

## Wishlist — auth

| Method & path | Response `data` |
|---|---|
| `GET /wishlist?page&limit` | `{ docs: [ { id, productId, addedAt, product: { id, name, slug, category, imageUrl, shortDescription, priceRange, available } } ], page, limit, totalDocs, totalPages, hasNextPage, wishlistId }`. Unpublished products are omitted |
| `POST /wishlist/items` `{ "productId": 245 }` | **201** `{ productId, itemId, alreadySaved }`. Saving twice is safe |
| `DELETE /wishlist/items/:productId` | `{ productId, removed: true }`; not saved → **404** |
| `GET /wishlist/check/:productId` | `{ productId, saved }` |

---

## Cart — auth

Cart object (`data` of every cart call):
```json
{
  "cartId": 243, "amountUnit": "paise", "currency": "INR",
  "coupon": { "code": "FESTIVE10", "id": 67, "promotion": "…" },
  "subtotalPaise": 500000, "discountPaise": 50000, "estimatedTotalPaise": 450000,
  "lines": [{
    "itemId": 223, "quantity": 2, "unitPricePaise": 250000, "lineTotalPaise": 500000, "valid": true,
    "product": { "id": 240, "name": "…", "slug": "…", "status": "active", "category": "Bangles", "imageUrl": "https://…" },
    "variant": { "id": 251, "sku": "…", "sizeCode": "free-size", "colorCode": "gold", "status": "active" }
  }]
}
```
`coupon` is `null` when none applies. `valid: false` means the line is no longer purchasable (product unpublished or variant inactive); checkout is refused until it is removed. Prices are recalculated from the server on every read. The cart does **not** reserve stock.

| Method & path | Body | Notes |
|---|---|---|
| `GET /cart` | | |
| `POST /cart/items` | `{ variantId, quantity?=1, productId? }` | **201**. Adds to an existing line. `MAX_QUANTITY_EXCEEDED` / `INSUFFICIENT_STOCK` / `UNAVAILABLE_*` → 422. Rapid repeated taps are applied one after another |
| `PATCH /cart/items/:itemId` | `{ quantity }` or `{ action: "increase"\|"decrease" }` | quantity 0 or a decrease to 0 removes the line |
| `DELETE /cart/items/:itemId` | | returns the cart |
| `DELETE /cart` | | empties the cart and removes the coupon; returns the cart |
| `POST /cart/apply-coupon` | `{ code }` (case-insensitive) | 422 `INVALID_COUPON`, `COUPON_EXPIRED`, `MINIMUM_CART_NOT_MET`, `INELIGIBLE_COUPON` (covers none of the items), `COUPON_LIMIT_REACHED`, `COUPON_CUSTOMER_LIMIT_REACHED` |
| `DELETE /cart/coupon` | | returns the cart |

---

## Checkout

### `POST /checkout/preview` — auth
`{ "addressId": 208, "paymentMethod": "cod", "couponCode"?: "…" }`
`paymentMethod`: `upi`, `card`, `netbanking`, `wallet`, `cod`. `couponCode` defaults to the coupon already on the cart.

**200** `data`:
```json
{
  "addressId": 208, "cartId": 243, "currency": "INR", "paymentMethod": "cod",
  "itemsSubtotalPaise": 500000, "discountPaise": 50000, "shippingPaise": 5000,
  "codFeePaise": 3000, "taxPaise": 0, "grandTotalPaise": 458000,
  "coupon": { "code": "FESTIVE10" },
  "lines": [ … same as cart lines … ],
  "shippingPolicy": { "handlingDays": 1, "serviceability": "development_all_india" },
  "taxPolicy": { "mode": "not_configured", "productionReady": false }
}
```
`grandTotalPaise = itemsSubtotal − discount + shipping + codFee + tax`. Errors: `COD_UNAVAILABLE`, `UNAVAILABLE_ITEM`, `INSUFFICIENT_STOCK` (409), `DELIVERY_UNAVAILABLE`, `UNSUPPORTED_PAYMENT_METHOD`.

### `POST /checkout/place-order` — auth
`{ "addressId": 208, "paymentMethod": "upi", "couponCode"?: "…", "idempotencyKey": "ord-lx3k-9f2a…" }`
`idempotencyKey`: 8–120 characters from `A–Z a–z 0–9 . _ : -`. **Generate one per checkout attempt and reuse it when retrying the same request.** The same key with the same choices returns the original order (`idempotentReplay: true`); with different choices → **409** `IDEMPOTENCY_KEY_REUSED`. Keys are private to each customer.

**201** `data`:
```json
{
  "idempotentReplay": false,
  "order": { …Order, see below… },
  "payment": null
}
```
- **Cash on delivery:** the order is `confirmed`, stock is consumed, `payment` is `null`.
- **Online:** the order is `pending_payment`, stock is held for `INVENTORY_RESERVATION_MINUTES` (default 15), and `payment` is
  `{ "provider": "razorpay", "clientKey": "rzp_…", "providerOrderId": "order_…", "amountPaise": 455000, "currency": "INR", "attemptId": 153 }` — everything the Razorpay SDK needs. Open the SDK with `key = clientKey`, `order_id = providerOrderId`, `amount = amountPaise`.
- **Gateway outage after the order was created:** HTTP 502 `PAYMENT_PROVIDER_ERROR`. The order exists and holds its stock. Show the order with **Pay now** (see `retry-payment`); replaying the same key returns the order with `payment: null`.
- Out-of-stock or lost race: **409** `INSUFFICIENT_STOCK` and no order is created.

---

## Payments

### `POST /payments/verify` — auth
After the Razorpay SDK succeeds: `{ "razorpayOrderId": "order_…", "razorpayPaymentId": "pay_…", "razorpaySignature": "…" }`
**200** `data: { verified: true, order: {Order} }` — the order is now `confirmed` / `paid`. Safe to call more than once.
Errors: **400** `INVALID_PAYMENT_SIGNATURE`; **404** `PAYMENT_ATTEMPT_NOT_FOUND` (not your order); **409** `PAYMENT_MISMATCH`, `PAYMENT_NOT_CAPTURED`.
If the app is closed before this call, the server still confirms the payment through the gateway webhook and a periodic reconciliation job, so the customer is never left charged without an order.

### `POST /my-orders/:id/retry-payment` — auth
For an online order still waiting for payment. **200** `data`: `{ provider, clientKey, providerOrderId, amountPaise, currency, attemptId, reused }`. Reuses the open gateway order when there is one. Errors: **409** `PAYMENT_RETRY_NOT_ALLOWED` (COD, already paid, cancelled), `RESERVATION_EXPIRED` (the hold ended and the order was cancelled).

`POST /payments/webhooks/razorpay` is for Razorpay only (HMAC-signed); the app never calls it.

---

## Orders — auth

Customer order routes live under `/my-orders` (`/orders` is Payload's staff-only collection route).

### `GET /my-orders?page&limit` → `data`: `{ docs: [Order without items], page, limit, totalDocs, totalPages, hasNextPage, hasPrevPage }`, newest first (limit ≤ 50).
### `GET /my-orders/:id` → `data`: Order. Another customer's order → **404** `ORDER_NOT_FOUND`.
### `POST /my-orders/:id/cancel` `{ "reason"?: "…" }` → `data`: the cancelled Order (with items and events). Releases held stock or restocks consumed stock, and frees the coupon. Paid orders → **409** `REFUND_REQUIRED` (cancellation of paid orders needs a refund, which is not part of this release). Already cancelled or shipped → **409** `INVALID_ORDER_TRANSITION`.

**Order**
```json
{
  "id": 176, "orderNumber": "JJ-2026-C894A1F6A7",
  "status": "pending_payment",
  "paymentStatus": "pending",
  "fulfillmentStatus": "unfulfilled",
  "paymentMethod": "upi", "currency": "INR",
  "itemsSubtotalPaise": 500000, "discountPaise": 50000, "shippingPaise": 5000,
  "taxPaise": 0, "codFeePaise": 0, "grandTotalPaise": 455000,
  "couponCodeSnapshot": "FESTIVE10",
  "shippingAddressSnapshot": { "recipientName": "…", "phoneNumber": "+91…", "line1": "…", "line2": "…", "landmark": null, "city": "Jaipur", "stateCode": "RJ", "pincode": "302001", "addressType": "home", "countryCode": "IN" },
  "paymentUnderReview": false,
  "placedAt": "…", "confirmedAt": null, "cancelledAt": null,
  "items": [{ "id": 153, "product": 245, "variant": 256, "skuSnapshot": "…", "productNameSnapshot": "…", "sizeSnapshot": "free-size", "colorSnapshot": "gold", "imageUrlSnapshot": "https://…", "quantity": 2, "unitPricePaise": 250000, "unitDiscountPaise": 25000, "lineSubtotalPaise": 500000, "lineDiscountPaise": 50000, "lineTotalPaise": 450000 }],
  "paymentAttempts": [{ "id": 153, "provider": "razorpay", "paymentMethod": "upi", "status": "pending", "amountPaise": 455000, "initiatedAt": "…", "completedAt": null }],
  "statusEvents": [{ "id": 204, "eventType": "order_created", "fromStatus": null, "toStatus": "pending_payment", "occurredAt": "…", "reason": null }]
}
```
- `status`: `pending_payment`, `confirmed`, `processing`, `packed`, `shipped`, `delivered`, `cancelled`, `returned`.
- `paymentStatus`: `unpaid` (COD), `pending`, `paid`, `failed`, `partially_refunded`, `refunded`.
- Items and totals are a **snapshot** taken at purchase: later price, name or address edits never change an existing order.
- `paymentUnderReview: true` means a payment arrived after the stock hold ended; staff are reconciling it. Show a "payment under review" message instead of Pay now.
- An unpaid online order whose hold expires is **cancelled automatically** (`status: "cancelled"`, the reservation released, the coupon freed).
- Staff notes added when moving an order are never included in `statusEvents.reason`.

---

## Health

`GET /health` → `{ "service": "jewelry-backend", "status": "healthy", "success": true }`; **503** when the database is unreachable.

## Staff-only endpoints (not used by the app)

`POST /admin/orders/:id/status`, `POST /admin/inventory/adjust` (`variantId`, `quantityDelta`, optional `operationId` for safe retries), `POST /admin/inventory-reservations/expire`, `POST /admin/maintenance/run`. Customer tokens receive **403**.

## Known limits

- Customer cancellation of **paid** orders, refunds and returns are not implemented (`REFUND_REQUIRED`).
- Password recovery is unavailable until an email adapter is configured.
- Shipping serviceability is a development fallback (all of India) and tax is calculated as zero (`taxPolicy.productionReady: false`).
- `imageUrl` values are absolute URLs built from `NEXT_PUBLIC_SERVER_URL`; set it to the public API address in production.
- The catalog list supports price sorting and variant filters over at most 500 matching products; name/newest listings are paginated by the database without that cap.
