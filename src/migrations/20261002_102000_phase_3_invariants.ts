import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "customer_addresses_one_default_idx"
      ON "customer_addresses" USING btree ("customer_id")
      WHERE "is_default" = true AND "is_active" = true;
    CREATE UNIQUE INDEX IF NOT EXISTS "carts_one_active_customer_idx"
      ON "carts" USING btree ("customer_id")
      WHERE "status" = 'active'::enum_carts_status;
    ALTER TABLE "customer_addresses"
      ADD CONSTRAINT "customer_addresses_pincode_check"
      CHECK ("pincode" ~ '^[1-9][0-9]{5}$');
    ALTER TABLE "cart_items"
      ADD CONSTRAINT "cart_items_quantity_check"
      CHECK ("quantity" >= 1 AND "quantity" = trunc("quantity"));
    ALTER TABLE "promotions"
      ADD CONSTRAINT "promotions_discount_value_check"
      CHECK (
        "discount_value" >= 0
        AND "discount_value" = trunc("discount_value")
        AND (
          "discount_type" <> 'percentage'::enum_promotions_discount_type
          OR "discount_value" <= 100
        )
      );
    ALTER TABLE "coupons"
      ADD CONSTRAINT "coupons_limits_check"
      CHECK (
        ("usage_limit" IS NULL OR ("usage_limit" >= 0 AND "usage_limit" = trunc("usage_limit")))
        AND (
          "per_customer_limit" IS NULL
          OR ("per_customer_limit" >= 0 AND "per_customer_limit" = trunc("per_customer_limit"))
        )
        AND "minimum_cart_paise" >= 0
        AND "minimum_cart_paise" = trunc("minimum_cart_paise")
      );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "coupons" DROP CONSTRAINT IF EXISTS "coupons_limits_check";
    ALTER TABLE "promotions" DROP CONSTRAINT IF EXISTS "promotions_discount_value_check";
    ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_quantity_check";
    ALTER TABLE "customer_addresses" DROP CONSTRAINT IF EXISTS "customer_addresses_pincode_check";
    DROP INDEX IF EXISTS "carts_one_active_customer_idx";
    DROP INDEX IF EXISTS "customer_addresses_one_default_idx";
  `)
}
