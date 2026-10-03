# Jewelry Backend

Payload CMS and Next.js backend for the Rajasthan jewelry commerce application. It includes PostgreSQL integration, authenticated administrator roles, the Payload Admin dashboard, a structured jewelry catalog, SKU-level inventory and movement history, public catalog APIs, migrations, seed data, and automated checks.

## Prerequisites

- Windows, macOS, or Linux
- Node.js 20.9 or newer (Node.js 24.18 was used during Phase 1)
- Corepack and pnpm 10.34.6
- PostgreSQL 18 installed natively

No Docker configuration is used or supported by this project.

The React Native app lives in its own repository (`mobile`). This repository documents the API it uses in `docs/api/MOBILE_API_REFERENCE.md`; the only code-level link is the optional end-to-end suite, described under *Validation commands*.

## PostgreSQL setup on Windows

The current environment has PostgreSQL 18 installed at `C:\Program Files\PostgreSQL\18` and the `postgresql-x64-18` service is running. Its client programs are not on `PATH`, so these examples use their full path.

Open PowerShell and connect as the existing PostgreSQL administrator. `-W` prompts for the password without placing it on the command line:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -d postgres -W
```

At the `psql` prompt, create a least-privilege application login and its development database:

```sql
CREATE ROLE jewelry_app LOGIN;
\password jewelry_app
CREATE DATABASE jewelry_ecommerce OWNER jewelry_app;
```

Do not place either PostgreSQL password in source control. Exit `psql` with `\q`.

Verify the new login:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U jewelry_app -d jewelry_ecommerce -W -c 'SELECT current_user, current_database(), current_setting(''server_version'');'
```

## Environment configuration

From `backend/`, copy the example file:

```powershell
Copy-Item .env.example .env
```

Set the database, Payload, server, and payment values in `.env`:

```dotenv
DATABASE_URL=postgresql://jewelry_app:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/jewelry_ecommerce
PAYLOAD_SECRET=YOUR_RANDOM_SECRET
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
INVENTORY_RESERVATION_MINUTES=15
```

Generate a Payload secret in PowerShell and paste the output into `.env`:

```powershell
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$secretBytes = New-Object byte[] 48
$random.GetBytes($secretBytes)
$random.Dispose()
[Convert]::ToBase64String($secretBytes)
```

URL-encode special characters in the database password before inserting it into `DATABASE_URL`. The `.env` file is ignored by Git.

## Install and run

From the repository root:

```powershell
cd backend
corepack pnpm@10.34.6 install
corepack pnpm@10.34.6 dev
```

Open:

- Payload Admin: <http://localhost:3000/admin>
- Health API: <http://localhost:3000/api/health>

The first account registered through Payload Admin is forced to the `super_admin` role and `active` status. Later admin creation and security-field changes require an active super administrator.

The health endpoint performs a lightweight query against PostgreSQL. It returns HTTP 200 with `status: "healthy"` only when that query succeeds, and HTTP 503 with `status: "unhealthy"` if a running application loses database access.

## Catalog and inventory

Payload Admin provides native CRUD screens for media, categories, curated collections, attribute definitions/options, products, variants, inventory, and immutable inventory movements. Catalog managers can manage catalog content; catalog managers, order managers, and super administrators can adjust stock.

Create the bundled development catalog after migrations:

```powershell
corepack pnpm@10.34.6 seed
```

The command is idempotent. It creates realistic products across bangles, earrings, jhumkas, necklaces, and bridal sets, including three size variants for the seeded bangle product. Existing inventory quantities are not reset. Replace the bundled placeholder through Payload Admin by uploading real product images with meaningful alt text.

Public mobile-facing endpoints:

- `GET /api/catalog/products` — active products with variants, price range, and availability.
- `GET /api/catalog/products/:id-or-slug` — one active product by numeric ID or slug.
- `GET /api/categories` — Payload REST endpoint restricted to active categories for anonymous users.
- `GET /api/collections` — Payload REST endpoint restricted to published collections for anonymous users.
- `GET /api/product-variants` — Payload REST endpoint restricted to active variants for anonymous users.

The catalog list supports `category`, `collection`, `minPrice`, `maxPrice`, `color`, `size`, `material`, `occasion`, `available`, `search`, `page`, `limit`, and `sort`. Prices are integer paise. Valid sort values are `price-low`, `price-high`, `newest`, and `name`; `limit` is capped at 50.

Example:

```text
GET /api/catalog/products?category=2&available=true&minPrice=100000&maxPrice=500000&sort=price-low&page=1&limit=20
```

Authenticated inventory staff can make audited adjustments through `POST /api/admin/inventory/adjust`:

```json
{
  "variantId": 1,
  "quantityDelta": 5,
  "reason": "manual_adjustment",
  "note": "Cycle count correction"
}
```

Direct public inventory writes are denied. Each on-hand change appends an immutable inventory movement.

## Customer authentication and shopping APIs

Customers and internal administrators are separate Payload authentication collections. Payload Admin continues to use only `admins`; a `customers` token cannot authenticate an administrator or access the Admin panel.

Register and log in:

```http
POST /api/customer-auth/register
Content-Type: application/json

{
  "firstName": "Asha",
  "lastName": "Sharma",
  "email": "asha@example.com",
  "password": "StrongPassword2026"
}
```

```http
POST /api/customers/login
Content-Type: application/json

{
  "email": "asha@example.com",
  "password": "StrongPassword2026"
}
```

The native login response includes a Payload token. React Native should send it on later requests:

```http
Authorization: JWT PAYLOAD_TOKEN
```

Store that token only in platform-backed Keychain/Keystore storage. Tokens expire after seven days; five failed login attempts lock the account for 15 minutes. `POST /api/customers/logout` revokes the current session. Payload's native `GET /api/customers/me` returns `user: null` after logout or when no valid session exists, so clients must treat that response as signed out even though its HTTP status is 200.

Customer endpoints:

- `GET /api/customers/me` — native Payload current-customer response.
- `PATCH /api/customers/me` — update first name, last name, or optional phone number.
- `POST /api/customer-auth/change-password` — verify the current password and set a strong new password.
- `GET|POST /api/addresses` — list or add owned addresses.
- `GET /api/addresses/default` — retrieve the default address.
- `PATCH|DELETE /api/addresses/:id` — update or soft-delete an owned address.
- `PATCH /api/addresses/:id/set-default` — transactionally switch the default address.
- `GET /api/wishlist` — paginated saved products.
- `GET /api/wishlist/check/:productId` — check whether a product is saved.
- `POST /api/wishlist/items` and `DELETE /api/wishlist/items/:productId` — add/remove products.
- `GET|DELETE /api/cart` — retrieve or clear the authenticated cart.
- `POST /api/cart/items` — add/consolidate a variant line.
- `PATCH|DELETE /api/cart/items/:itemId` — set/increase/decrease/remove a cart line.
- `POST /api/cart/apply-coupon` and `DELETE /api/cart/coupon` — preview or remove a coupon.

Cart responses contain current server-side integer-paise prices, line totals, subtotal, discount, and estimated total. Adding to a cart checks current stock but does not reserve it. Coupon application does not consume a redemption; order-time reservation and redemption belong to Phase 4.

Run `corepack pnpm@10.34.6 seed` to add/update the development `WELCOME10` coupon (10%, ₹500 cap, ₹1,000 minimum). No customer credentials are seeded.

Password recovery is not operational until a transactional email adapter is configured. Do not use the native forgot-password route in a deployed environment with the current console email adapter, because there is no secure customer delivery channel yet.

## Checkout, orders, and payments

Phase 4 adds server-authoritative checkout, PostgreSQL-safe inventory reservations, immutable order snapshots, COD, coupon redemption, customer order history, controlled Admin transitions, and Razorpay contracts.

- `POST /api/checkout/preview`
- `POST /api/checkout/place-order`
- `GET /api/my-orders` and `GET /api/my-orders/:id`
- `POST /api/my-orders/:id/cancel`
- `POST /api/my-orders/:id/retry-payment`
- `POST /api/payments/verify`
- `POST /api/payments/webhooks/razorpay`
- `POST /api/admin/orders/:id/status`
- `POST /api/admin/inventory-reservations/expire`
- `POST /api/admin/maintenance/run`

Customer order routes live under `/api/my-orders` because `/api/orders` is Payload's own route for the `orders` collection, which is staff-only. A background job runs every minute (`MAINTENANCE_JOBS_ENABLED`) to cancel unpaid orders whose inventory hold expired and to settle online payments whose confirmation was lost. The full customer API is documented in `docs/api/MOBILE_API_REFERENCE.md`.

Supported payment method values are `upi`, `card`, `netbanking`, `wallet`, and `cod`. Razorpay secrets must never be sent to the mobile app; only the client key, gateway order ID, currency, and server-calculated amount are returned for SDK initialization. With blank Razorpay credentials, checkout preview and COD work while online order initialization fails explicitly and safely.

Configure local shipping/COD behavior under **Settings → Shipping Settings** in Payload Admin. The bundled all-India mode is a development-only fallback, not carrier-confirmed serviceability. Tax calculation is also provisional until the business tax policy is finalized. See `docs/architecture/COMMERCE_FLOW.md` and `docs/progress/PHASE_4.md` for lifecycle and recovery details.

## Migrations

Development schema auto-sync (`push`) is **disabled** in `payload.config.ts`: push creates tables without the hand-written CHECK constraints and leaves migration history out of step with the database. Every schema change ships as a migration. After changing a collection:

```powershell
corepack pnpm@10.34.6 migrate:create -- phase-name
corepack pnpm@10.34.6 migrate:status
```

Commit generated files from `src/migrations/` with the matching schema changes. For a production release, back up the database and run pending migrations before starting the new application version:

```powershell
corepack pnpm@10.34.6 migrate
```

Never use `migrate:reset`, `migrate:fresh`, or another destructive database command without explicit approval and a verified backup.

## Validation commands

```powershell
corepack pnpm@10.34.6 generate:types
corepack pnpm@10.34.6 format:check
corepack pnpm@10.34.6 typecheck
corepack pnpm@10.34.6 lint
corepack pnpm@10.34.6 test
corepack pnpm@10.34.6 build
```

`test` runs the database-free unit tests. `test:e2e` runs the end-to-end suite: it imports the mobile app's own API client from a checkout of the mobile repository (the sibling folder `../mobile`, or the path in `MOBILE_APP_DIR`) and runs it against the real handlers and PostgreSQL. It refuses to run unless the database name ends in `_test` (set `TEST_DATABASE_URL`) or `E2E_ALLOW_SHARED_DB=true` is set. See `docs/progress/PHASE_4_5_AUDIT.md`.

Create the first administrator with `ADMIN_EMAIL=... ADMIN_PASSWORD=... corepack pnpm@10.34.6 create-admin`. Anonymous first-admin signup is available only outside production.

## Troubleshooting

- **`pnpm` is not recognized:** use `corepack pnpm@10.34.6` exactly as shown; no global pnpm install is required.
- **`psql` is not recognized:** use the full PostgreSQL binary path shown above or add that `bin` directory to your user `PATH`.
- **`password authentication failed`:** verify the username/password independently with `psql -W`, then URL-encode the password in `DATABASE_URL`.
- **Health endpoint is unavailable during startup:** Payload needs PostgreSQL while initializing. Check `Get-Service postgresql-x64-18` and `pg_isready` first.
- **Health endpoint returns 503:** the app started but its live database query failed; inspect PostgreSQL availability and application logs.
- **Port 3000 is occupied:** run `corepack pnpm@10.34.6 dev -- -p 3001` and update `NEXT_PUBLIC_SERVER_URL` to match.

Official references: [Payload installation](https://payloadcms.com/docs/getting-started/installation), [PostgreSQL adapter](https://payloadcms.com/docs/database/postgres), and [database migrations](https://payloadcms.com/docs/database/migrations).
