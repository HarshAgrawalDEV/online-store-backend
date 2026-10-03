# Phase 2 — Product Catalog & Inventory Foundation

Date: 2026-10-02

## Outcome

Phase 2 is implemented on the existing standalone Payload CMS backend. Administrators can manage the complete catalog through Payload Admin, products support sellable variants, every seeded SKU has separate online inventory, stock changes create immutable movement records, and public mobile-facing catalog endpoints support validated filtering, search, sorting, and pagination.

No React Native app, cart, wishlist, customer OTP, checkout, payments, Docker configuration, separate Express server, pnpm workspace, Git commit, or remote push was introduced.

## Collections implemented

| Collection | Purpose and important fields |
|---|---|
| `media` | Local image uploads, required alt text, kind/caption/credit, and thumbnail/card/hero image sizes |
| `categories` | Unique slug, optional parent, image, description, order, active status, and SEO fields |
| `collections` | Curated collection title/slug, summary, hero image, occasion, publication window/status, order, and reverse product join |
| `catalog-attribute-definitions` | Unique structured attribute definitions with product/variant scope, value type, filtering flag, and order |
| `catalog-attribute-options` | Attribute-bound options, unique code per definition, label, optional swatch, active status, and order |
| `products` | Unique slug, descriptions, status, categories/collections, jewelry details, tags, occasions, specifications, care/returns/tax data, gallery, featured image, SEO, and publication date |
| `product-variants` | Product relationship, unique SKU, normalized option signature, size/color/finish/options, integer-paise prices, private cost, status, barcode, image, weight, and order limit |
| `inventory` | One row per variant, on-hand/reserved/reorder quantities, calculated availability, and stock status |
| `inventory-movements` | Append-only quantity delta, reason, references, administrator, note, and occurrence time |

All collections use Payload timestamps. The workbook's future inventory reservation entity is intentionally deferred until Phase 4, when order/cart relationships exist; the current `reserved` quantity and validation rules leave room for that workflow.

## Relationships and integrity

- Categories form a self-referential hierarchy; hooks reject self-parenting and ancestor cycles.
- Products have one primary category and optional additional categories and curated collections.
- Products expose ordered gallery rows; each row can optionally target a variant.
- Variants belong to a product and can reference structured attribute options.
- `(product, optionSignature)` and SKU uniqueness prevent duplicate purchasable configurations.
- Attribute option codes are unique within their definition.
- Every inventory row has a unique variant relationship.
- Active products require a featured image and at least one active variant.
- An active product cannot lose its final active variant through deactivation or deletion.
- Prices and inventory quantities must be nonnegative integers; compare-at price cannot be lower than selling price; reserved stock cannot exceed on-hand stock.
- Product/category/collection/SKU/filter fields have database indexes matching expected catalog queries.
- Catalog prices are always stored and returned as integer paise.

## Access control and admin workflow

- Active `super_admin` and `catalog_manager` users manage catalog records.
- Active `super_admin`, `catalog_manager`, and `order_manager` users manage inventory.
- Anonymous reads are limited to active categories, published collections, active products, active variants, and active attribute options.
- Inventory and movement collections are staff-only. Inventory movements deny create/update/delete through normal APIs; they are created only by the audited inventory hook.
- `costPaise` is staff-only and is explicitly removed from custom public catalog responses.
- Products must be created as drafts, then given imagery and active variants before publication.

## APIs

Payload REST endpoints remain available under `/api`; their collection access rules enforce public visibility. The following custom endpoints simplify mobile catalog use:

### `GET /api/catalog/products`

Returns active products with active variants, integer-paise price ranges, and computed availability. Supported parameters:

- Filters: `category`, `collection`, `minPrice`, `maxPrice`, `color`, `size`, `material`, `occasion`, and `available`.
- Search: `search` across product name, short description, material, plating, and stone type.
- Sorting: `price-low`, `price-high`, `newest` (default), or `name`.
- Pagination: `page` and `limit`; the maximum page size is 50.

Example:

```text
GET /api/catalog/products?available=true&maxPrice=200000&sort=price-low&page=1&limit=12
```

### `GET /api/catalog/products/:identifier`

Returns one active product by numeric ID or unique slug, including active variants and availability. Draft/archived products return 404.

### `POST /api/admin/inventory/adjust`

Requires an authenticated inventory-capable administrator. It validates a positive variant ID, a non-zero integer quantity delta, the reason, and optional note. It rejects adjustments that would make on-hand stock negative or lower than reserved stock, updates stock, and appends a movement using the same database request/transaction context.

## Migration and seed data

Generated migration:

```text
backend/src/migrations/20261002_092441_phase_2_catalog_inventory.ts
```

The existing development-pushed Phase 1 schema was baselined in `payload_migrations`; the generated additive Phase 2 migration then ran successfully on PostgreSQL 18.6.

Run pending migrations and seed data from `backend/`:

```powershell
corepack pnpm@10.34.6 migrate
corepack pnpm@10.34.6 seed
```

The idempotent seed creates five products across bangles, earrings, jhumkas, necklaces, and bridal sets; five categories; six curated collections; color and size definitions/options; seven SKUs (including three bangle sizes); one bundled local placeholder upload; inventory rows; and initial-stock movements. Rerunning it updates catalog details while preserving existing inventory quantities and does not duplicate movements.

For real imagery, use Payload Admin's Media screen to upload local product photography, provide descriptive alt text, and assign it as product, gallery, category, collection, or variant imagery. The placeholder deliberately avoids expiring external URLs.

## Verification

| Check | Result |
|---|---|
| Payload type generation and strict TypeScript | Passed |
| Unit tests | Passed: 3 files, 16 tests |
| Phase 2 PostgreSQL migration | Passed |
| Seed rerun/idempotency | Passed; rerun produced no duplicate base records or movements |
| Live public list endpoint | Passed; filtering, price sorting, page size, totals, and availability verified |
| Live slug detail endpoint | Passed; active variant returned and `costPaise` absent |
| Generated category/collection/variant access | Enforced by collection access rules |
| ESLint and production build | Passed; optimized Next.js build completed successfully |

## Known limitations and later phases

- Seed imagery is a development placeholder; production photography and storage/CDN selection remain operational work.
- Popularity sorting is deferred until real engagement or sales data exists.
- Checkout-time inventory reservations, expiration/release, and order-linked movements are deferred to Phase 4.
- Customer reviews and historical sales were not fabricated.
- Admin browser CRUD remains available for manual acceptance testing with an administrator account; automated tests focus on server-side rules and public API behavior.
- The current list service caps the pre-pagination result set at 500 products and variant loading at 1,000 records. Replace the in-memory price ordering strategy with a denormalized minimum-price field or optimized SQL when catalog scale requires it.
