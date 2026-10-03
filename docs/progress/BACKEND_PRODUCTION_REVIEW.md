# Backend production readiness review

Review completed: **3 October 2026 (Asia/Calcutta)**. Scope: the current Phase 1–3 backend in this working tree, using Payload **3.90.2**, Next.js **16.3.3**, and PostgreSQL. File line numbers refer to this snapshot.

## 1. Assessment

**I would not approve the current version for an unrestricted customer production launch.** This conclusion is based on defects in implemented features, independently of the intentionally unfinished checkout, payment, order, and shipping work.

The architecture is a reasonable foundation. Keep the Payload/Next.js modular monolith and PostgreSQL. The immediate need is stronger authorization boundaries, concurrency control, complete catalog queries, reliable cart calculations, and a repeatable deployment process. Splitting this application into microservices now would add operational work without fixing these problems.

The current backend can support development and a controlled staging environment. A seamless production experience is not established: ordinary concurrent requests can lose changes, a larger catalog becomes incomplete, and existing authorization paths need tightening. No customer count or requests-per-second capacity can be responsibly promised without representative data, deployment specifications, and load measurements.

### What is already sound

- Separate customer and administrator authentication collections, with the Admin application configured to use `admins`.
- Customer ownership is derived from the authenticated identity in custom shopping services. Generic customer writes are restricted.
- Products, sellable variants, and inventory are separate entities. Stable customer IDs connect shopping records.
- Server-side pricing uses integer paise. Clients do not supply accepted product prices or discounts.
- Unique SKU, variant option signature, inventory/variant, wishlist/product, and cart/variant constraints exist.
- The Phase 3 invariant migration adds one active cart/customer and at most one active default address/customer.
- Address operations explicitly share a transaction. Inventory movement creation passes the request into the hook's nested write.
- Strict TypeScript, generated Payload types, migrations, linting, and an initial test suite are present.

### Intentionally deferred work

The absence of orders, checkout, payment attempts, shipping, stock reservations, coupon redemption records, guest carts, OTP, and mobile integration is acknowledged in [Phase 3](docs/progress/PHASE_3.md). Their absence is **not classified as a coding defect** in this review. However, accepting real purchases must remain unavailable until the order/payment safeguards in section 7 exist. Cart stock checks and coupon previews are not purchase commitments.

## 2. Evidence and validation limits

This review inspected domain collections, access functions, hooks, services, custom endpoints, migrations, tests, application configuration, seed behavior, and setup/progress documentation. Implemented collection definitions and migrations were treated as the schema authority; this is not a field-by-field reconciliation against the planning spreadsheet.

Several framework-sensitive conclusions were checked against the **installed package source**, including transaction boundaries, relationship population, field access overrides, SQL limits, password hashing validation, session invalidation, and the default email adapter.

| Verification performed | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed |
| `node node_modules/eslint/bin/eslint.js .` | Passed |
| Four database-free Vitest files, listed below | **22 tests passed** |
| Eight isolated probes against the application functions with synthetic dependencies | Reproduced the behaviors listed below |
| Backup exposure check | Two SQL files contain role password verifiers; neither is ignored by Git |

Commands above run from `backend/`. Test command:

```text
node node_modules/vitest/vitest.mjs run --config ./vitest.config.mts tests/admin-access.spec.ts tests/catalog.spec.ts tests/customer-validation.spec.ts tests/health.spec.ts
```

Vitest initially encountered Windows sandbox `spawn EPERM`; the approved run outside the sandbox passed. This was an execution-environment limitation, not a failing application assertion.

The isolated probes reproduced: last-active-variant reparenting without validation; explicit removal of an active product's featured image; invalid cart lines contributing to totals; a coupon reported as applied with no eligible products; inventory lost updates; cart lost updates; catalog truncation at 500 products; and malformed JSON classified as HTTP 500. Concurrency probes supplied competing read snapshots to the actual service functions: they demonstrate the unsafe algorithm, **not a PostgreSQL concurrency benchmark**.

**Not performed:** a production build/start, live HTTP security tests, the database-writing integration suite, fresh-database migration replay, load testing, backup restoration, or a dependency vulnerability audit. The integration suite currently loads the normal `.env` and writes to its database; there is no isolated test database guard. Prior progress reports' successful integration/build results are historical evidence, not rerun results for this review. No application code, credentials, database records, or backup files were changed by this review.

Evidence labels below:

- **Probe:** reproduced in a database-free execution of application functions.
- **Source:** traced through application code and, where necessary, installed framework code; verify over HTTP/database in regression tests.
- **Deployment:** a required production control is absent from the repository or remains unverified. An external hosting configuration might supply it.

Priorities: **P1** means resolve before exposing the affected production capability. **P2** means resolve before broader rollout or growth; it may still be release-blocking for a particular business requirement. These priorities are recommendations, not claims that an incident has already occurred.

## 3. Findings at a glance

| ID | Priority | Area | Main problem |
| --- | --- | --- | --- |
| R01 | P1 | Wishlist responses | Access overrides and populated documents can expose internal fields |
| R02 | P1 | Staff permissions | Every active staff role can alter customer security and shopping records |
| R03 | P1 | Admin bootstrap | An empty admin table permits anonymous super-admin creation |
| R04 | P1 | Stock changes | Concurrent adjustments lose updates; retries can duplicate adjustments |
| R05 | P1 | Cart/wishlist writes | Read-then-write races cause lost quantities or uniqueness failures |
| R06 | P1 | Catalog queries | Fixed candidate limits silently omit valid products and variants |
| R07 | P1 | Cart pricing | Availability and quantity rules are not rechecked in the returned cart |
| R08 | P2 | Coupons | Ineligible coupons can be reported as applied; failure can leave changes |
| R09 | P1 | Inventory schema | Stock can be reassigned to another SKU; important SQL checks are absent |
| R10 | P2 | Deletion flows | Required relationships use `SET NULL`; deletion often fails unexpectedly |
| R11 | P1 | Public catalog access | Variant visibility ignores parent publication status |
| R12 | P2 | Publication rules | Image removal and variant moves bypass product invariants |
| R13 | P2 | Phone identity | Phone changes preserve verification; unverified numbers are globally unique |
| R14 | P2 | Saved addresses | Default changes race; records beyond the read limit become hidden |
| R15 | P1 | Authentication | Recovery is undeliverable; password policy differs across entry points |
| R16 | P1 | Abuse protection | Public operations lack demonstrated shared rate and resource limits |
| R17 | P1 | Media | Local disk storage is unsuitable for ephemeral or multiple app instances |
| R18 | P2 | API validation/errors | Client mistakes and expected conflicts become server errors |
| R19 | P2 | Schema consistency | Duplicate option representations and partial-update validation can diverge |
| R20 | P2 | Read performance/cache | Sequential cart reads and overly broad responses/cache policy |
| R21 | P1 | Test/release confidence | Integration tests target the normal database; critical paths lack coverage |
| R22 | P1 | Migrations/configuration | Release replay is unproven; development seed can overwrite real content |
| R23 | P1 | Operations | Recovery, connection budgets, timeout behavior, and alerting are unproven |
| R24 | P1 | Repository hygiene | Database password verifiers are in unignored backup files |
| R25 | P2 | Auditability | Sensitive staff changes lack an application audit trail |

## 4. Detailed findings and fixes

### R01 — Privileged wishlist reads return populated internal documents

**P1 · Source.** Files: [services/wishlist.ts](backend/src/services/wishlist.ts), lines 46–61 and 92–99; [Products.ts](backend/src/collections/Products.ts), lines 135–139; [ProductVariants.ts](backend/src/collections/ProductVariants.ts), lines 93–97.

`listWishlist` and `addWishlistProduct` use `overrideAccess: true`, `depth: 2`, and return the resulting documents directly. Payload propagates the override when populating relationships and skips field read access under that override. The path from a wishlist item to its product and the product's variants can therefore expose `costPaise`, which the normal variant API protects. Related unpublished catalog metadata can also be populated. Checking ownership of the top-level wishlist does not make every nested field public.

**Fix:** use privileged queries only for the minimum ownership lookup; load catalog data with normal read access and explicit selection. Return a small, allow-listed wishlist response containing product identity, public image, price summary, and availability. Avoid returning raw CMS documents from privileged services.

**Acceptance:** save a product whose variant has a known private cost and an inactive sibling; inspect both add and list HTTP responses recursively. Neither private costs nor unpublished nested content should appear. This exact HTTP check was not run during the review.

### R02 — Customer administration grants every staff role excessive authority

**P1 · Source.** Files: [access/customers.ts](backend/src/access/customers.ts), lines 22–38; [Customers.ts](backend/src/collections/Customers.ts), lines 26–31 and 71–84; customer address/cart/wishlist collection access blocks.

`staffOnly`, `staffOrSelf`, `ownerRead`, and `customerSecurityField` all trust `isActiveStaff` without checking the role. A catalog manager or support account can read all customer profiles/addresses, update customer accounts through native CRUD, change status/phone verification, and invoke permitted deletes. Customer password/email fields have no additional application restriction. Staff can also change cart lines directly, bypassing the custom service's stock and per-order checks.

**Impact:** a compromised lower-privilege staff account has a much larger customer-data and account-control impact than its role suggests. A catalog edit permission should not implicitly confer customer password-setting authority.

**Fix:** define a role/action matrix. Separate customer support read access, customer security administration, deletion/anonymization, catalog editing, and stock operations. Restrict sensitive auth fields explicitly. Route staff shopping changes through the same domain rules or make those records read-only in Admin.

**Acceptance:** test every role against REST, GraphQL, and custom routes. A catalog manager must be unable to set a customer's password, mark a phone verified, or read unrelated customer addresses unless explicitly granted that business permission.

### R03 — First-admin registration is unsafe on a publicly reachable empty installation

**P1 · Source; conditional on an empty admin table.** Files: [access/admins.ts](backend/src/access/admins.ts), lines 30–39 and 55–64; [Admins.ts](backend/src/collections/Admins.ts), lines 29–36.

An anonymous request is allowed to create an admin when the admin count is zero. The hook forces that account to `super_admin`. There is no deployment-only bootstrap switch or single-use provisioning credential. Concurrent requests can also both observe zero. The same exposure returns if all admin accounts are deleted; there is no last-super-admin guard.

**Fix:** provision the initial administrator through a controlled deployment command before public routing. Disable anonymous bootstrap in production and preserve at least one active super administrator through guarded administration. Require MFA or an equivalent protected staff access layer for production administration.

**Acceptance:** a fresh production-mode deployment rejects public admin creation; provisioning succeeds through the intended private mechanism. Concurrent bootstrap attempts cannot create multiple privileged accounts. Do not interpret this as a bypass of the current nonempty-table check.

### R04 — Inventory adjustments are not safe under concurrent requests or retries

**P1 · Probe + Source.** Files: [services/inventory.ts](backend/src/services/inventory.ts), lines 55–105; [hooks/inventory.ts](backend/src/hooks/inventory.ts), lines 18–46; [endpoints/inventory.ts](backend/src/endpoints/inventory.ts), lines 18–29.

The service reads `onHand`, calculates a new absolute balance, then updates it. Two adjustments starting from 10 can calculate 15 and 17; the final balance can be 17 instead of 22. The probe reproduced this with competing read snapshots. The hook can record misleading deltas depending on what each operation reads. A network retry of the same adjustment also applies the change again because there is no operation ID.

**Fix:** perform the balance check and change under a database row lock in one transaction, or use an atomic conditional update. Append the corresponding movement in that same transaction. Give external adjustments an idempotency key protected by a unique constraint and record before/after balances. All staff entry points must use this mutation path.

**Acceptance:** concurrent `+5` and `+7` changes from 10 produce 22 and exactly the intended movements. Repeating the same operation ID applies once. Concurrent decrements cannot cross the reserved balance. A movement-write failure rolls back the stock change.

**Framework nuance:** the existing hook already passes `req`, so the movement and its individual Payload update can share a transaction. The missing protection is the entire read/check/write sequence and concurrency serialization. [Payload transactions](https://payloadcms.com/docs/database/transactions) and [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html) describe the mechanisms involved.

### R05 — Cart and wishlist mutations race despite useful uniqueness constraints

**P1 · Probe + Source.** Files: [services/cart.ts](backend/src/services/cart.ts), lines 11–28, 121–151, 171–195, and 207–224; [services/wishlist.ts](backend/src/services/wishlist.ts), lines 7–24 and 82–98.

Existing cart quantities are read and replaced with absolute values. Two simultaneous increments from one can both write two instead of reaching three. First-use cart/wishlist creation and duplicate line insertion follow find-then-create patterns. Unique indexes protect against duplicate persisted rows, but there is no conflict recovery, so one request fails. Clearing a cart and removing its coupon are separate writes; additions can interleave with them. Several GET operations create containers as a side effect.

**Fix:** serialize mutations per cart/customer using a database lock or use version-based optimistic concurrency with bounded retries. Use atomic upsert/conflict recovery for containers and deduplicated wishlist items. Give retried additive requests a stable operation key, or offer absolute quantity updates with a version precondition. Make clear-cart a defined transactional operation.

**Acceptance:** multiple simultaneous first-use calls return the same container; concurrent additions have the documented result; duplicate wishlist submissions return an idempotent success; clear/add conflicts are deterministic. A transaction alone at ordinary isolation is not sufficient for an unprotected read-then-write calculation.

### R06 — Catalog pagination is incorrect once candidate limits are reached

**P1 · Probe + Source.** File: [services/catalog-query.ts](backend/src/services/catalog-query.ts), lines 6–7, 207–295, and 316–323.

The service fetches up to 500 products and 1,000 variants, filters/sorts in memory, and reports the length of the truncated product array as `totalDocs`. Product detail separately limits variants to 100. The installed PostgreSQL adapter still applies an explicit SQL `limit` when `pagination: false`; that option does not remove these caps.

**Impact:** product 501 may never appear; cheaper products outside the candidate set cannot participate in price sorting; missing variants can make prices or availability wrong. Variant filters are evaluated globally before narrowing to the relevant product/category, so even a small category can lose matches in a large catalog. The synthetic 501-product probe returned `totalDocs: 500` and an empty page 26.

**Fix:** push filtering, aggregate price/availability, ordering, and pagination into the database. Count the complete matching set. Use stable secondary ordering by ID. Load only the selected page's public details. For more complex browsing, maintain a database-backed catalog projection with explicitly defined refresh behavior.

**Acceptance:** use a fixture larger than all current caps, including a low-price match beyond the first 500 products. Verify totals, every page, price sorting, category filters, and variant availability against independently calculated expectations.

### R07 — Cart responses can say a line is valid after it becomes unpurchasable

**P1 · Probe + Source.** Files: [services/pricing.ts](backend/src/services/pricing.ts), lines 60–99 and 128–155; [services/cart.ts](backend/src/services/cart.ts), lines 58–109.

Add/update checks inventory and `maxPerOrder`, but `calculateCartPricing` only marks validity from product/variant status. It does not reload stock, pause state, reserved stock, or the current quantity limit. Even lines explicitly marked `valid: false` still contribute to subtotal, minimum-coupon eligibility, discount calculations, and estimated total. The invalid-line total behavior was reproduced.

**Impact:** a customer opening an old cart sees a credible total for unavailable goods, or qualifies for a discount using a product they cannot purchase. This is already a cart-preview defect; order-time reservation is a separate future feature.

**Fix:** batch-load current variants/products/inventory and calculate explicit per-line reasons such as `OUT_OF_STOCK`, `PRODUCT_UNAVAILABLE`, or `QUANTITY_LIMIT_CHANGED`. Define a purchasable subtotal and use it consistently. Keep unavailable lines visible so the customer can resolve them; do not silently discard them. Checkout must independently validate again.

**Acceptance:** add an item, then pause stock, lower `maxPerOrder`, archive the product, and reduce availability in separate scenarios. Each subsequent cart read must explain the conflict and return totals according to the documented policy.

### R08 — Coupon eligibility and persistence are inconsistent

**P2 · Probe + Source.** Files: [services/cart.ts](backend/src/services/cart.ts), lines 228–249; [services/pricing.ts](backend/src/services/pricing.ts), lines 122–145 and 159–196.

`validateCouponForCart` checks status, dates, minimum subtotal, and zero limits, but does not check whether any line matches the promotion. Pricing sets `couponSummary` even when eligible subtotal is zero. Therefore the subsequent `if (!priced.coupon)` check does not reject a promotion for unrelated products: the response can say applied with zero discount. The probe reproduced that case.

The coupon relationship is also persisted before final pricing succeeds. A concurrent promotion change or pricing failure can produce an error response while leaving the coupon on the cart.

**Fix:** make eligibility and calculation one reusable operation over the same cart snapshot. Validate the intended zero-discount behavior explicitly. Persist only after successful validation, with transactional/version protection. Do not use cart application to consume redemptions; real usage counting remains an order-time feature.

**Acceptance:** a promotion restricted to product A cannot be successfully applied to a cart containing only B. A rejected application leaves the previous coupon unchanged. Expiry or cart changes produce a clear reason when a previously applied coupon stops applying.

### R09 — Inventory identity and numeric integrity need stronger enforcement

**P1 · Source.** Files: [Inventory.ts](backend/src/collections/Inventory.ts), lines 15–32; [hooks/inventory.ts](backend/src/hooks/inventory.ts), lines 10–45; [Phase 2 migration](backend/src/migrations/20261002_092441_phase_2_catalog_inventory.ts), lines 182–223; [Phase 3 invariants](backend/src/migrations/20261002_102000_phase_3_invariants.ts).

Authorized inventory staff can update the `variant` relationship on an existing stock row. Changing it to a variant without an inventory row transfers the balance to another SKU. If `onHand` is unchanged, the movement hook records nothing. Historical movements still refer to the old SKU.

Price/stock columns are PostgreSQL `numeric`; application validators enforce many rules, but the migrations do not add SQL checks for integral nonnegative stock/prices, `reserved <= onHand`, or integral nonzero movement deltas. Phase 3 does add checks for several shopping fields, so this is an inconsistency rather than a total absence of constraints.

**Fix:** make inventory's variant identity immutable. Model transfers/corrections as explicit audited operations. Add SQL constraints for core financial/stock invariants and realistic application bounds that keep sums/products within JavaScript's safe integer range. Keep `numeric` with constraints or choose a compatible bounded integer representation; changing every numeric column is unnecessary.

**Acceptance:** changing an inventory row's SKU is rejected through Admin, REST, and privileged service calls. Invalid direct SQL writes fail. Boundary arithmetic cannot silently lose precision. Define whether `stockStatus` is an independent administrative pause or a derived stock result; direct Admin edits currently can leave it inconsistent with the balance.

### R10 — Deletion policies conflict with required foreign keys and business history

**P2 · Source.** Files: [Phase 2 migration](backend/src/migrations/20261002_092441_phase_2_catalog_inventory.ts), lines 239–260; [Phase 3 migration](backend/src/migrations/20261002_101603_phase_3_customer_shopping.ts), lines 144–155; delete permissions in product, variant, category, customer, coupon, and promotion collections.

Many required relationship columns are `NOT NULL` but their foreign keys use `ON DELETE SET NULL`: examples include variant→product, inventory→variant, address→customer, and cart-item→variant. Deleting a referenced parent attempts to set a required column to null and therefore fails. This is a deletion failure, **not evidence that PostgreSQL silently creates null orphans**. Optional media references can become null without rerunning the product publication hook.

**Fix:** explicitly choose lifecycle behavior per relationship. Archive products/variants with shopping or stock history; use `RESTRICT` plus a useful domain error for protected references. Cascade disposable container children only through a deliberate deletion flow. Define customer anonymization and retention before hard-deletion support. Prevent removal of media required by published products.

**Acceptance:** deleting each referenced entity either follows a documented cleanup/anonymization policy or returns a useful conflict. No stock history is lost and no active product loses required media silently.

### R11 — Public variant and collection visibility is incomplete

**P1 · Source.** Files: [access/catalog.ts](backend/src/access/catalog.ts), lines 37–49; [ProductVariants.ts](backend/src/collections/ProductVariants.ts), lines 17–21 and 100–105; [CuratedCollections.ts](backend/src/collections/CuratedCollections.ts), lines 69–82.

The native public `product-variants` read filter only checks the variant's own status. Variants default to active and can belong to draft or archived products. Their SKU, price, and other public fields can be enumerated through native REST/GraphQL even when the custom product endpoint hides the parent.

Curated collection reads only check `isPublished`; `startsAt` and `endsAt` do not affect visibility. If those dates are intended to schedule a campaign, future and expired campaigns remain exposed. Category deactivation similarly does not automatically remove its products; that behavior needs an explicit business rule.

**Fix:** centralize public sellability/visibility rules, including parent product status, and apply them to native collections and custom responses. Define collection scheduling semantics. Do not rely on clients to call only the preferred custom endpoint.

**Acceptance:** anonymous REST and GraphQL queries cannot read active variants of unpublished parents. Campaign visibility changes at the documented boundaries. Treat category visibility as a product decision rather than assuming it must cascade.

### R12 — Publication invariants can be bypassed by ordinary edits

**P2 · Probe + Source.** Files: [hooks/products.ts](backend/src/hooks/products.ts), lines 10–18; [hooks/variants.ts](backend/src/hooks/variants.ts), lines 64–68; [Products.ts](backend/src/collections/Products.ts), line 112.

`data.featuredImage ?? originalDoc.featuredImage` validates the old image when the caller explicitly supplies `null`; the hook then returns the null update. Also, moving an active variant to another product does not check the old product's remaining variants unless status changes. Both behaviors were reproduced. Concurrent deactivation of the final two variants is another race because each can count the other as active.

**Fix:** distinguish an omitted field from an explicit null. Make variant parent identity immutable once used, or validate both affected products in a locked transaction. Serialize publication-relevant changes by product. Apply equivalent protection when deleting linked media.

**Acceptance:** clearing an active product's featured image fails; moving its last active variant fails; concurrent removal/deactivation cannot leave an active product without a sellable variant.

### R13 — Phone verification does not follow the actual phone number

**P2 · Source; required before using phone verification as an identity signal.** Files: [services/customer-auth.ts](backend/src/services/customer-auth.ts), lines 116–143; [Customers.ts](backend/src/collections/Customers.ts), lines 57–75.

Profile updates change `phoneNumber` without clearing `phoneVerified`. A customer whose number was verified by staff can replace it and retain the verified flag. The globally unique phone column also lets an unverified claimant occupy a number and prevent its real owner from saving it.

**Fix:** invalidate verification whenever the normalized number changes, across customer and staff update paths. Separate a pending/contact number from a verified identity. If uniqueness is intended for identity, enforce it at verified linking with an ownership/recovery flow. Continue using customer IDs for all shopping relationships.

**Acceptance:** changing or clearing a verified number clears its proof. An unverified claim cannot permanently prevent the verified owner from linking that phone. Current phone handling is not an implemented OTP login vulnerability; OTP remains deferred.

### R14 — Address defaults and collection sizes have unresolved edge cases

**P2 · Source.** File: [services/addresses.ts](backend/src/services/addresses.ts), lines 67–76, 168–205, 210–223, and 270–282; [invariant migration](backend/src/migrations/20261002_102000_phase_3_invariants.ts), lines 5–7; [services/cart.ts](backend/src/services/cart.ts), lines 31–41.

Address transactions and the partial unique index correctly protect against persisting two active defaults. They do not serialize competing default changes: one can fail with a uniqueness conflict that becomes HTTP 500. Ownership/active checks occur before the transaction in some paths. A customer can explicitly unset the only default while other addresses remain.

Address reads cap results at 100 without limiting address creation. Cart reads also cap lines at 100 without enforcing a maximum distinct-line count. Beyond those limits, saved data or cart lines are silently absent, and cart totals cover only the returned lines. Clearing `line2`/`landmark` produces `undefined`, which does not express an explicit persisted null in a partial update.

**Fix:** lock the customer/default-address scope and revalidate inside the transaction; map expected conflicts. Decide whether zero defaults is allowed. Enforce a reasonable address/cart size limit or paginate without silently omitting priced lines. Use explicit null semantics for clearing optional values.

**Acceptance:** simultaneous default changes return consistent results; an optional address field can be cleared; record 101 is either rejected with a clear limit or remains reachable and correctly represented.

### R15 — Authentication recovery and password rules need a complete contract

**P1 · Source + Deployment.** Files: [payload.config.ts](backend/src/payload.config.ts), lines 37–87; [Customers.ts](backend/src/collections/Customers.ts), lines 15–24; [Admins.ts](backend/src/collections/Admins.ts), line 20; [services/customer-auth.ts](backend/src/services/customer-auth.ts), lines 148–184; [customer-validation.ts](backend/src/lib/customer-validation.ts), lines 12–20.

There is no transactional email adapter. Native forgot/reset operations still exist because authentication is enabled; a README warning does not disable them. The installed console adapter logs attempted recipient/subject and does not deliver the email. It does **not** log the reset token in the inspected implementation, so token leakage through that adapter is not asserted here.

The 10–128-character password policy is enforced by custom registration/change-password services. Native reset and staff/native password writes do not call that function; the installed hashing validator has a default minimum of three characters. Admin auth also uses defaults rather than a shared application policy.

**Fix:** configure delivery with correct customer-facing reset links and test it, or explicitly disable unsupported public recovery operations until available. Enforce the agreed password policy at every password-setting entry point, including native reset, using supported auth hooks/operations. Validate admin policy separately. Define post-password-change session behavior: the custom service calls `payload.login` to check the old password, which creates a session and replaces `req.user`, then returns no replacement token after updating the password.

**Acceptance:** reset reaches the intended inbox/client, tokens expire and cannot be reused, weak passwords are rejected across all routes, suspended users stay blocked, and existing/current session behavior after password change is tested and documented. Payload already invalidates sessions during password updates; do not add a finding that all old sessions are retained. See [authentication operations](https://payloadcms.com/docs/authentication/operations) and [email configuration](https://payloadcms.com/docs/email/overview).

### R16 — Abuse protection must cover native and custom public operations

**P1 · Deployment + Source.** Files: [payload.config.ts](backend/src/payload.config.ts); [customer-auth endpoints](backend/src/endpoints/customer-auth.ts); [REST route](backend/src/app/%28payload%29/api/%5B...slug%5D/route.ts); [GraphQL route](backend/src/app/%28payload%29/api/graphql/route.ts).

No shared IP/account rate limiting or deployment gateway policy is present for registration, login, password recovery, catalog search, or shopping mutations. Login attempt lockout and forgot-password per-account spacing help, but do not bound distributed account creation, expensive password hashing, or query traffic. Native collection APIs expose query shapes beyond the capped custom list route.

**Fix:** implement measured per-IP and per-account limits at a shared gateway/store, bounded body/query sizes, request deadlines, and sensible customer record quotas. Review allowed native routes and GraphQL use. Keep necessary Admin functionality while restricting unused public surfaces. Use trusted proxy configuration for client IPs and return `429`/retry information.

**Acceptance:** exercise bursts across multiple app instances and verify consistent limiting without locking ordinary customers out. Profile the worst allowed query. Payload already supplies a default maximum population depth of 10 and GraphQL complexity of 1,000 in this installation; the issue is lack of application-specific limits and validation, not absence of all framework protection.

### R17 — Uploaded media is tied to one machine

**P1 · Source + Deployment.** File: [Media.ts](backend/src/collections/Media.ts), lines 43–51; [payload.config.ts](backend/src/payload.config.ts), line 86.

Uploads go to `process.cwd()/media`; no storage adapter is configured. On ephemeral hosting, a replacement instance can lose files while database records still reference them. With two independent app instances, an image uploaded to one may be missing on the other. A single server with durable storage can work temporarily, but its persistence/backup behavior must be explicit.

`image/*` also accepts more formats than the application needs, including SVG. There is no project-specific file-size policy or documented handling of active SVG content. Only catalog staff can upload, which reduces exposure; this is not an anonymous-upload finding or a demonstrated XSS exploit.

**Fix:** use shared durable object storage and a CDN, migrate existing objects, and verify generated image URLs. Restrict formats, file bytes, image dimensions, and processing concurrency. Reject or sanitize SVG and serve assets with an appropriate origin/content policy. Back up/version media alongside database recovery planning. [Payload storage adapters](https://payloadcms.com/docs/upload/storage-adapters) support this architecture.

**Acceptance:** upload through one instance and fetch through another and after a deployment replacement. Invalid/oversized files fail predictably. A restore recovers both database metadata and the corresponding files.

### R18 — Error handling turns expected client failures into HTTP 500

**P2 · Probe + Source.** Files: [lib/api-response.ts](backend/src/lib/api-response.ts), lines 35–49; [endpoints/inventory.ts](backend/src/endpoints/inventory.ts), lines 18–29; JSON parsing in cart/address/wishlist/customer endpoints; [services/cart.ts](backend/src/services/cart.ts), lines 50–55.

The shared handler recognizes `MobileAPIError` and selected 401 errors, then reports everything else as internal failure. Malformed JSON, native not-found errors, field validation failures, and database uniqueness conflicts can become 500s. The malformed-JSON case was reproduced. Registration's duplicate precheck cannot guarantee a consistent 409 under a race. Some inputs are coerced with `String`/`Number`, so arrays/booleans can become plausible field values rather than being rejected as the wrong type.

**Fix:** add strict schemas for requests, one JSON parse/error wrapper, and a stable error taxonomy: malformed/invalid input, unauthenticated, forbidden, not found, conflict, unavailable inventory, rate limited, and unexpected server failure. Translate known database constraint errors without exposing SQL or private values. Preserve useful per-field errors. Standardize custom response envelopes and document intentional native-auth differences.

**Acceptance:** invalid JSON returns 400; an unknown variant returns the documented 404/422; duplicate phone or concurrent duplicate registration returns a stable conflict/validation response; malformed types are rejected. Unexpected errors retain server-side diagnostic detail with a safe client message.

### R19 — Several schema rules can diverge across representations and partial edits

**P2 · Source.** Files: [ProductVariants.ts](backend/src/collections/ProductVariants.ts), lines 40–68; [hooks/variants.ts](backend/src/hooks/variants.ts), lines 40–77; [Promotions.ts](backend/src/collections/Promotions.ts), lines 23–30; [Coupons.ts](backend/src/collections/Coupons.ts), lines 21–26; [CuratedCollections.ts](backend/src/collections/CuratedCollections.ts), lines 24–29.

Size/color/finish codes coexist with an extensible `optionValues` array and a generated signature, but there is no canonical mapping between them or one-value-per-attribute constraint. Duplicate attribute rows alter signatures and can represent an ambiguous variant. Gallery entries also do not explicitly enforce that a referenced variant belongs to the gallery's product.

Promotion/coupon/collection date checks compare only fields supplied in `data`. Patching just `endsAt` can bypass comparison with the existing `startsAt`. The promotion percentage check has a similar partial-update issue, although the SQL invariant protects the percentage ceiling when that migration is installed; date-window constraints are absent.

**Fix:** choose canonical variant options, derive denormalized filter codes, enforce per-variant attribute uniqueness, and validate gallery ownership. Validate merged effective documents while preserving explicit null meaning. Add database checks for simple date/numeric invariants where supported. Payload does validate relationship `filterOptions`; do not assume it is only an Admin dropdown filter.

**Acceptance:** duplicate/conflicting options and cross-product gallery variants are rejected; changing only one date cannot create an invalid range. Tests cover both full creation and partial updates.

### R20 — Read paths do unnecessary work and cache errors as public content

**P2 · Source.** Files: [services/pricing.ts](backend/src/services/pricing.ts), lines 60–82; [services/catalog-query.ts](backend/src/services/catalog-query.ts), lines 181–202 and 250–289; [endpoints/catalog.ts](backend/src/endpoints/catalog.ts), lines 10–26.

Cart pricing explicitly awaits variant and product reads for every line, including repeated products. Product population adds work. This creates latency that grows with cart size and consumes database capacity. Payload may batch some relationship population internally, but the explicit sequential service calls remain. Catalog responses spread full product documents and populate depth 2 before slicing the final page.

The catalog JSON helper sets `public, max-age=60, stale-while-revalidate=300` for success, validation errors, not-found responses, and server failures alike. It marks error responses cacheable to intermediaries that honor the policy. Price/stock visibility can also remain stale across the configured freshness and revalidation window; no invalidation flow is present.

**Fix:** batch distinct IDs, use shallow selections and explicit response objects, and fetch only the requested page. Cache successful public catalog responses under a deliberate policy; use `no-store` for 5xx and unsuitable errors. Separate stable product content from frequently changing availability if needed, and define invalidation. Keep authoritative stock/price checks on mutations and checkout.

**Acceptance:** measure query count and p95 latency for 1/20/100 lines. A catalog outage is not served from an error cache after recovery. Clients have a documented freshness contract and are insulated from incidental CMS schema changes.

### R21 — Tests are useful but not isolated or sufficient for release confidence

**P1 · Source + Deployment.** Files: [phase3-integration.spec.ts](backend/tests/phase3-integration.spec.ts), lines 1–65 and cleanup section; [vitest.config.mts](backend/vitest.config.mts); [package.json](backend/package.json).

The integration suite loads the ordinary `.env`, creates a known-password customer, and depends on whichever first active product/variant and `WELCOME10` happen to exist. Cleanup depends on normal completion. The test config includes this suite in the default `test` command. Pointing that environment at a shared or production database would write test data there. The current tests do not automatically cover HTTP role matrices, concurrent stock/cart updates, private-field leakage, migration replay, or catalog limits.

**Fix:** require a dedicated `TEST_DATABASE_URL` with an allow-list/safety assertion; disable schema push and apply migrations explicitly. Create deterministic owned fixtures and clean up reliably. Separate fast unit, isolated integration, HTTP authorization, migration, and load suites. Add CI gates using frozen dependencies, lint, typecheck, tests, and a production build/start smoke check.

**Acceptance:** a production-looking database target causes tests to refuse to start. Tests pass on an empty migrated test database without running the development seed. Include regressions from this report; passing 22 unit tests is useful but does not establish production readiness.

### R22 — Migration, configuration, and seed behavior need a controlled release path

**P1 · Source + Deployment.** Files: [payload.config.ts](backend/src/payload.config.ts), lines 74–84; [migrations/index.ts](backend/src/migrations/index.ts); [Phase 3 notes](docs/progress/PHASE_3.md), migration section; [seed/index.ts](backend/src/seed/index.ts), lines 200–202, 345–365, and 458–499; [README](backend/README.md).

Phase 3 notes describe manual baselining after partially applied migration DDL. That does not prove the checked-in chain is broken, but successful clean replay and upgrade replay have not been demonstrated in this review. Handwritten checks/partial indexes must also survive future generated migrations and development schema pushes.

There is no centralized production environment validation. `serverURL` can silently fall back to localhost, while database/secret configuration uses empty fallbacks. Payload does reject a missing secret; this is not a claim that empty-secret signing works. The adapter skips development schema push when `NODE_ENV=production`, so automatic production push is not asserted either.

The development seed has no environment guard. It updates existing named products, variant prices/content, and promotions/coupons; its repeatability is not a guarantee that it preserves staff edits. An interrupted run can leave a seeded product in its intermediate draft state.

**Fix:** validate production secrets/URLs/database settings at startup; make schema push explicitly development-only; rehearse clean and upgrade migrations in isolation. Run migrations as a controlled release step, then verify readiness. Separate migration and runtime database privileges. Add an explicit environment guard to development seeds and keep release data migrations separate.

**Acceptance:** an empty database reaches the expected schema using committed migrations; an upgrade fixture retains data and all invariants; a failed release has a rehearsed recovery path. Production configuration rejects localhost placeholders, and the development seed refuses a production target.

### R23 — Operational resilience is not demonstrated by the current health endpoint

**P1 · Deployment.** Files: [payload.config.ts](backend/src/payload.config.ts), lines 79–84; [health.ts](backend/src/endpoints/health.ts), lines 15–35; [backend README](backend/README.md); repository deployment/monitoring configuration.

The health endpoint checks PostgreSQL via an admin query, which is useful readiness evidence. There is no separate database-independent liveness route, explicit connection/query/lock timeout budget, metrics/tracing configuration, alert routing, or tested recovery runbook in the repository. Pool settings are defaults and no total connection budget is documented. External infrastructure could supply some controls; it was not available for review.

**Fix:** define liveness versus readiness; bound dependency timeouts; document graceful drain/restart behavior. Set per-instance pool sizes so total app/worker/migration connections fit the database. Use protected backups, point-in-time recovery where required, and scheduled restore drills including media. Monitor request latency/errors, pool waits, query latency, conflicts, auth failures, and inventory reconciliation. Set explicit recovery-point and recovery-time objectives with the business.

**Acceptance:** a database outage produces bounded failures and useful alerts; it does not cause uncontrolled restart churn or indefinitely queued requests. A restore drill meets the agreed objectives. Measure p95/p99 latency and error rates under the intended load before claiming capacity.

### R24 — Backup files contain sensitive verifiers and are eligible for accidental commit

**P1 · Source; exposure prevention.** Files: [.gitignore](.gitignore); `backups/postgres16-full-before-v18.sql:35`; `backups/postgres16-restore-v18.sql:35`.

Both SQL files contain database-role password verifiers. The review checked only the presence/location and did not copy the values. Git reports the backup directory as untracked, and `git check-ignore` does not exclude these files. There is no evidence from this review that they were committed or published. Password verifiers are sensitive even though they are not plaintext passwords.

**Fix:** keep database dumps outside the source tree in protected backup storage and add a suitable ignore rule plus secret scanning. Inspect intended staged content before the first commit. If copies were already shared outside the trusted environment, rotate the affected role credential and address those copies. Do not delete the only usable backup as a hygiene fix.

**Acceptance:** routine staging cannot include these dumps, scanning catches equivalent sensitive files, and protected backups remain available for restoration.

### R25 — Sensitive staff changes lack durable application-level audit records

**P2 · Source.** Files: [Admins.ts](backend/src/collections/Admins.ts); [Customers.ts](backend/src/collections/Customers.ts); catalog/promotion collections; [InventoryMovements.ts](backend/src/collections/InventoryMovements.ts).

Inventory movements record stock changes, but there is no comparable audit record for role/status changes, customer security changes, price edits, promotions, or publication changes. `updatedAt` does not identify who changed which values or why. Admin `lastLoginAt` is declared but has no corresponding login update hook.

**Fix:** add a bounded audit mechanism with actor, action, entity, timestamp, request/operation ID, and appropriately redacted before/after values. Protect its write/read policy and retention. Never include passwords, session tokens, reset tokens, or unnecessarily complete customer address data. Record required staff login/security events consistently.

**Acceptance:** support can reconstruct an unexpected price, discount, stock, or permission change without examining raw sensitive request logs. Audit writes have a defined reliability policy and access restrictions.

## 5. Architecture and coding standards to adopt

Keep the monolith, with clearer internal responsibilities:

```text
HTTP/custom endpoints and Payload-native entry points
    -> authentication, authorization, strict input schemas
    -> application services (one business operation per transaction)
    -> domain rules (sellability, pricing, ownership, lifecycle)
    -> Payload/PostgreSQL persistence
    -> explicit public/admin response models
```

Collections should define persistence, access policy, and invariants that must hold from every entry point. Services should own complete business operations. Hooks should remain small and predictable; avoid distributing one critical operation across unrelated side effects. When raw SQL is needed for locking or atomic updates, isolate it in a persistence helper, use the same transaction, parameterize values, and explicitly preserve audit/validation behavior that a direct SQL write bypasses.

The current folders are workable. A possible gradual organization is `modules/catalog`, `modules/inventory`, `modules/customers`, and `modules/shopping`, each with service, policy, validation, and response types. A folder rename is lower priority than fixing R01–R09. Move generic route-ID parsing out of `services/addresses.ts`, share a transaction helper, and reduce unchecked type casts where request validation should establish types.

Specific standards:

1. No public response may spread a privileged Payload document. Use selected fields and response objects.
2. Every `overrideAccess: true` call must have a clear owner/role justification and a safe output boundary.
3. Database uniqueness protects stored state; expected uniqueness conflicts still need deterministic API behavior.
4. Numeric and lifecycle invariants must be enforced at the appropriate database and service boundaries.
5. Add/update, clear, and coupon operations need explicit concurrency/retry semantics.
6. Use one sellability definition across native reads, catalog, wishlist, cart, and future checkout.
7. Version the mobile-facing API contract before external clients depend on it; CMS field additions should not silently alter it.

### Schema changes worth making before orders

| Concern | Existing basis | Recommended change |
| --- | --- | --- |
| Stock | One inventory row/variant, movement history | Immutable variant identity; atomic balance mutations; SQL checks; operation ID; before/after audit |
| Product lifecycle | Status enums and publication hooks | Guard nulls, variant moves, concurrency, and media deletion; archive used entities |
| Variant identity | Unique SKU and option signature | Canonical option values, one value/attribute, constrained denormalized filter fields |
| Customer identity | Separate auth collection and stable ID | Restrict staff security actions; invalidate phone proof when number changes |
| Shopping ownership | Required owner/container relationships | Explicit deletion/retention policies and guarded staff writes |
| Cart consistency | Unique line and active-cart indexes | Per-cart serialization/version; bounded line count; consistent revalidation |
| Promotion rules | Date/status/eligibility fields | Merged-document validation; consistent preview eligibility; order-time redemption model later |
| Query indexes | Useful unique and single-column indexes | Add composite indexes from actual query plans, not by indexing every field |

After fixing R06, inspect `EXPLAIN (ANALYZE, BUFFERS)` on representative staging data. Candidate access patterns include active products ordered by publication date/ID, variant lookup by product/status/options, and active addresses by customer/default. Text `contains` searches may need a PostgreSQL full-text or trigram strategy. Select the index after confirming the generated SQL and selectivity; current B-tree text indexes are not a general solution to substring search.

## 6. Scaling approach

### Stage A — Correct and observable single-region deployment

Use a production Node deployment with restart/drain supervision, PostgreSQL, shared object storage, a CDN, a controlled migration step, and verified backups. A small initial deployment can be operationally simple. It still needs bounded database calls, monitoring, rate limiting, and all affected P1 fixes.

Build a representative dataset and exercise browsing, search/filtering, login, cart reads/writes, and staff stock edits. Agree on latency/error targets; for example, p95 targets for browsing and cart mutations can be initial engineering goals, not guarantees. Measure them with cold/warm caches and background administration active.

### Stage B — Add application replicas after state is externalized

Run stateless app replicas behind a load balancer when measurements justify it. Share database, media, rate-limit state, and any authoritative cache coordination. Budget connections as:

```text
app replicas × pool maximum
+ worker pools
+ migration/maintenance headroom
<= the database connection allocation
```

Cache public catalog data deliberately, batch cart queries, and keep transactions short. Introduce durable workers for email, image processing, and later order notifications when synchronous work affects latency. Use a transactional outbox for effects that must follow a committed business operation; retries need idempotency and failure visibility.

### Stage C — Scale the measured bottleneck

Use a catalog projection or dedicated search service when PostgreSQL query/index improvements no longer meet the browsing requirements. Consider read replicas for stale-tolerant catalog/reporting workloads only; inventory reservations, payment/order transitions, and immediate cart consistency must use an authoritative write path. Scale workers independently when queue lag, rather than HTTP traffic, is the constraint.

Extract a separate service only when there is a demonstrated ownership, failure-isolation, or independent scaling need. Do not introduce distributed stock/order transactions merely to anticipate hypothetical traffic.

### Load and failure scenarios that matter

- Large catalog beyond the existing caps, including many variants per product and selective filters.
- Multiple devices modifying the same customer's cart.
- Concurrent staff stock adjustments and, later, competition for the final sellable item.
- Slow/unavailable database, exhausted pool, app restart during a write, and delayed background workers.
- Retried requests, coupon expiry during an operation, and catalog changes while a cart remains open.
- Multiple app instances fetching media uploaded by another instance.

Record throughput, p50/p95/p99 latency, error/conflict rates, CPU/memory, database waits/connections, and invariant violations. A test that is fast but loses cart quantities is a failed capacity test.

## 7. Future purchase flow: requirements before taking real orders

This is forward design guidance for the deferred phase, not an assertion that unfinished features should already exist.

1. **Quote:** reprice authoritative variants, validate quantity/availability/coupon eligibility, calculate documented tax/shipping/discount rounding, and return a quote version/expiry.
2. **Create pending order:** use a customer-scoped idempotency key and immutable line, price, discount, tax, and delivery-address snapshots. Lock inventory rows in a deterministic order, create reservations, and reserve coupon capacity transactionally.
3. **Initiate payment:** persist a payment attempt/provider reference. Do not hold database locks while calling a payment provider. Handle timeouts as an uncertain result that needs reconciliation, not permission to charge again.
4. **Confirm payment:** verify provider callbacks and deduplicate provider event IDs. Apply permitted order/payment transitions once. A mobile-client success message is not authoritative proof of payment.
5. **Fulfill or release:** convert/release reservations and redemption capacity exactly once according to the lifecycle. Expiry workers, cancellations, failed payments, returns, and late payment callbacks need explicit competing-transition rules.
6. **Reconcile:** detect provider/database mismatches, missed callbacks, expired reservations, and stock ledger differences. Publish durable notifications through an outbox/worker.

Suggested new records are orders/order items, payment attempts/events, inventory reservations, coupon redemptions/reservations, and outbox jobs. Give each an owner, status transition model, uniqueness constraints, timestamps, and retry/reconciliation behavior. Order records must retain snapshots even when live customer/catalog data changes.

## 8. Implementation sequence and release gates

| Sequence | Deliverable | Exit evidence |
| --- | --- | --- |
| 1 | Close response leaks, tighten staff permissions, protect admin provisioning, secure backups (R01–R03, R11, R24) | HTTP role/field tests; fresh-install provisioning test; safe staging/secret scan |
| 2 | Make inventory/cart/wishlist/default-address operations concurrency-safe (R04–R05, R09, R14) | Real PostgreSQL parallel tests, retry tests, rollback tests, invariant reconciliation |
| 3 | Correct catalog and cart/coupon semantics (R06–R08, R12–R13, R18–R20) | Large fixtures, lifecycle regression tests, stable errors, query/latency measurements |
| 4 | Establish operational release controls (R10, R15–R17, R21–R23, R25) | Isolated CI, migration replay, production build/start, media failover, rate-limit checks, restore drill |
| 5 | Complete purchase lifecycle when that phase begins | Order/payment/reservation/webhook idempotency and reconciliation tests |

A **catalog-only launch** can defer customer/shopping work if those routes are actually disabled or protected; hiding UI buttons is insufficient. A **customer-account/cart launch** needs the applicable auth, ownership, pricing, persistence, and concurrency findings resolved. A **purchase launch** additionally needs section 7.

Before release, record the target hosting environment, expected traffic/data size, latency and availability objectives, migration/rollback owner, backup restoration evidence, and alert ownership. Resolve each finding with a test or deployment artifact rather than marking it done solely because a code change exists.

## 9. File and flow navigation

| Files/flow | Findings |
| --- | --- |
| `src/access/admins.ts`, `collections/Admins.ts` | R03, R15, R25 |
| `src/access/customers.ts`, `collections/Customers.ts`, `services/customer-auth.ts` | R02, R13, R15, R18 |
| `src/access/catalog.ts`, public native collection reads | R11, R16 |
| `services/wishlist.ts`, wishlist collections | R01, R02, R05, R18 |
| `services/cart.ts`, cart collections | R02, R05, R07, R08, R14, R18 |
| `services/pricing.ts`, promotions/coupons | R07, R08, R19, R20 |
| `services/addresses.ts`, address collection | R02, R10, R14, R18 |
| `services/inventory.ts`, inventory collections/hooks | R04, R09, R10, R18 |
| `services/catalog-query.ts`, `endpoints/catalog.ts` | R06, R11, R20 |
| Product/variant/category/collection hooks and schemas | R10–R12, R19 |
| `collections/Media.ts` | R10, R12, R17 |
| `lib/api-response.ts`, endpoint body parsing/validation | R18 |
| `payload.config.ts`, `next.config.ts`, generated route entry points | R15–R17, R22–R23 |
| `src/migrations/` | R06, R09–R10, R14, R19, R21–R22 |
| `src/seed/index.ts`, `tests/`, `vitest.config.mts`, `package.json` | R21–R22 |
| Root `.gitignore`, `backups/` | R24 |
| Deployment/operations controls not represented in the repository | R16–R17, R21–R23, R25 |

Framework references were checked for transaction, authentication, and storage behavior; installed source was preferred where defaults or version-specific behavior mattered. [Payload production guidance](https://payloadcms.com/docs/production/deployment) is a useful release companion. No claim is made here that the installed dependency versions are free of security advisories.
