import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_orders_status" AS ENUM('pending_payment', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned');
  CREATE TYPE "public"."enum_orders_payment_status" AS ENUM('unpaid', 'pending', 'paid', 'partially_refunded', 'refunded', 'failed');
  CREATE TYPE "public"."enum_orders_fulfillment_status" AS ENUM('unfulfilled', 'partial', 'fulfilled', 'returned');
  CREATE TYPE "public"."enum_orders_payment_method" AS ENUM('upi', 'card', 'netbanking', 'wallet', 'cod');
  CREATE TYPE "public"."enum_orders_currency" AS ENUM('INR');
  CREATE TYPE "public"."enum_order_status_events_from_status" AS ENUM('pending_payment', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned');
  CREATE TYPE "public"."enum_order_status_events_to_status" AS ENUM('pending_payment', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned');
  CREATE TYPE "public"."enum_order_status_events_actor_type" AS ENUM('system', 'customer', 'admin', 'carrier');
  CREATE TYPE "public"."enum_inventory_reservations_status" AS ENUM('active', 'committed', 'released', 'expired');
  CREATE TYPE "public"."enum_payment_attempts_provider" AS ENUM('razorpay', 'cashfree', 'manual_cod');
  CREATE TYPE "public"."enum_payment_attempts_payment_method" AS ENUM('upi', 'card', 'netbanking', 'wallet', 'cod');
  CREATE TYPE "public"."enum_payment_attempts_currency" AS ENUM('INR');
  CREATE TYPE "public"."enum_payment_attempts_status" AS ENUM('created', 'pending', 'authorized', 'paid', 'failed', 'expired', 'cancelled');
  CREATE TYPE "public"."enum_payment_webhook_events_provider" AS ENUM('razorpay', 'cashfree');
  CREATE TYPE "public"."enum_payment_webhook_events_status" AS ENUM('received', 'processed', 'ignored', 'failed');
  CREATE TYPE "public"."enum_coupon_redemptions_status" AS ENUM('allocated', 'redeemed', 'released');
  CREATE TYPE "public"."enum_shipping_settings_local_serviceability_mode" AS ENUM('disabled', 'development_all_india');
  CREATE TABLE "orders" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_number" varchar NOT NULL,
  	"customer_id" integer NOT NULL,
  	"cart_id" integer,
  	"idempotency_key" varchar NOT NULL,
  	"request_hash" varchar NOT NULL,
  	"status" "enum_orders_status" NOT NULL,
  	"payment_status" "enum_orders_payment_status" NOT NULL,
  	"fulfillment_status" "enum_orders_fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
  	"payment_method" "enum_orders_payment_method" NOT NULL,
  	"currency" "enum_orders_currency" DEFAULT 'INR' NOT NULL,
  	"items_subtotal_paise" numeric NOT NULL,
  	"discount_paise" numeric DEFAULT 0 NOT NULL,
  	"shipping_paise" numeric DEFAULT 0 NOT NULL,
  	"tax_paise" numeric DEFAULT 0 NOT NULL,
  	"cod_fee_paise" numeric DEFAULT 0 NOT NULL,
  	"grand_total_paise" numeric NOT NULL,
  	"shipping_address_snapshot" jsonb NOT NULL,
  	"billing_address_snapshot" jsonb,
  	"pricing_breakdown" jsonb,
  	"coupon_code_snapshot" varchar,
  	"customer_note" varchar,
  	"exception_code" varchar,
  	"placed_at" timestamp(3) with time zone NOT NULL,
  	"confirmed_at" timestamp(3) with time zone,
  	"cancelled_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "order_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"product_id" integer,
  	"variant_id" integer,
  	"sku_snapshot" varchar NOT NULL,
  	"product_name_snapshot" varchar NOT NULL,
  	"size_snapshot" varchar,
  	"color_snapshot" varchar,
  	"image_url_snapshot" varchar,
  	"quantity" numeric NOT NULL,
  	"unit_price_paise" numeric NOT NULL,
  	"unit_discount_paise" numeric DEFAULT 0 NOT NULL,
  	"line_subtotal_paise" numeric NOT NULL,
  	"line_discount_paise" numeric DEFAULT 0 NOT NULL,
  	"line_tax_paise" numeric DEFAULT 0 NOT NULL,
  	"line_total_paise" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "order_status_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"from_status" "enum_order_status_events_from_status",
  	"to_status" "enum_order_status_events_to_status" NOT NULL,
  	"event_type" varchar NOT NULL,
  	"actor_type" "enum_order_status_events_actor_type" NOT NULL,
  	"actor_id" varchar,
  	"reason" varchar,
  	"metadata" jsonb,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "inventory_reservations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"variant_id" integer NOT NULL,
  	"quantity" numeric NOT NULL,
  	"status" "enum_inventory_reservations_status" DEFAULT 'active' NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"released_at" timestamp(3) with time zone,
  	"committed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payment_attempts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"provider" "enum_payment_attempts_provider" NOT NULL,
  	"payment_method" "enum_payment_attempts_payment_method" NOT NULL,
  	"provider_order_id" varchar,
  	"provider_payment_id" varchar,
  	"idempotency_key" varchar NOT NULL,
  	"amount_paise" numeric NOT NULL,
  	"currency" "enum_payment_attempts_currency" DEFAULT 'INR' NOT NULL,
  	"status" "enum_payment_attempts_status" DEFAULT 'created' NOT NULL,
  	"failure_code" varchar,
  	"failure_message" varchar,
  	"initiated_at" timestamp(3) with time zone NOT NULL,
  	"completed_at" timestamp(3) with time zone,
  	"last_verified_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payment_webhook_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"provider" "enum_payment_webhook_events_provider" NOT NULL,
  	"external_event_id" varchar NOT NULL,
  	"kind" varchar NOT NULL,
  	"signature_verified" boolean DEFAULT false NOT NULL,
  	"payload_redacted" jsonb,
  	"status" "enum_payment_webhook_events_status" DEFAULT 'received' NOT NULL,
  	"processed_at" timestamp(3) with time zone,
  	"error_code" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "coupon_redemptions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"coupon_id" integer NOT NULL,
  	"customer_id" integer NOT NULL,
  	"order_id" integer NOT NULL,
  	"amount_paise" numeric NOT NULL,
  	"status" "enum_coupon_redemptions_status" NOT NULL,
  	"allocated_at" timestamp(3) with time zone NOT NULL,
  	"redeemed_at" timestamp(3) with time zone,
  	"released_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "shipping_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"free_shipping_above_paise" numeric DEFAULT 0,
  	"standard_fee_paise" numeric DEFAULT 0,
  	"cod_enabled" boolean DEFAULT true NOT NULL,
  	"cod_fee_paise" numeric DEFAULT 0,
  	"handling_days" numeric DEFAULT 1,
  	"local_serviceability_mode" "enum_shipping_settings_local_serviceability_mode" DEFAULT 'development_all_india' NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "carts" ADD COLUMN "converted_order_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "orders_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "order_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "order_status_events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "inventory_reservations_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "payment_attempts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "payment_webhook_events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "coupon_redemptions_id" integer;
  ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");
  CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");
  CREATE UNIQUE INDEX "orders_cart_idx" ON "orders" USING btree ("cart_id");
  CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");
  CREATE INDEX "orders_payment_status_idx" ON "orders" USING btree ("payment_status");
  CREATE INDEX "orders_fulfillment_status_idx" ON "orders" USING btree ("fulfillment_status");
  CREATE INDEX "orders_placed_at_idx" ON "orders" USING btree ("placed_at");
  CREATE INDEX "orders_updated_at_idx" ON "orders" USING btree ("updated_at");
  CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
  CREATE UNIQUE INDEX "customer_idempotencyKey_idx" ON "orders" USING btree ("customer_id","idempotency_key");
  CREATE INDEX "customer_placedAt_idx" ON "orders" USING btree ("customer_id","placed_at");
  CREATE INDEX "status_placedAt_idx" ON "orders" USING btree ("status","placed_at");
  CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");
  CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");
  CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");
  CREATE INDEX "order_items_updated_at_idx" ON "order_items" USING btree ("updated_at");
  CREATE INDEX "order_items_created_at_idx" ON "order_items" USING btree ("created_at");
  CREATE INDEX "order_status_events_order_idx" ON "order_status_events" USING btree ("order_id");
  CREATE INDEX "order_status_events_occurred_at_idx" ON "order_status_events" USING btree ("occurred_at");
  CREATE INDEX "order_status_events_updated_at_idx" ON "order_status_events" USING btree ("updated_at");
  CREATE INDEX "order_status_events_created_at_idx" ON "order_status_events" USING btree ("created_at");
  CREATE INDEX "order_occurredAt_idx" ON "order_status_events" USING btree ("order_id","occurred_at");
  CREATE INDEX "inventory_reservations_order_idx" ON "inventory_reservations" USING btree ("order_id");
  CREATE INDEX "inventory_reservations_variant_idx" ON "inventory_reservations" USING btree ("variant_id");
  CREATE INDEX "inventory_reservations_status_idx" ON "inventory_reservations" USING btree ("status");
  CREATE INDEX "inventory_reservations_expires_at_idx" ON "inventory_reservations" USING btree ("expires_at");
  CREATE INDEX "inventory_reservations_updated_at_idx" ON "inventory_reservations" USING btree ("updated_at");
  CREATE INDEX "inventory_reservations_created_at_idx" ON "inventory_reservations" USING btree ("created_at");
  CREATE UNIQUE INDEX "order_variant_idx" ON "inventory_reservations" USING btree ("order_id","variant_id");
  CREATE INDEX "status_expiresAt_idx" ON "inventory_reservations" USING btree ("status","expires_at");
  CREATE INDEX "payment_attempts_order_idx" ON "payment_attempts" USING btree ("order_id");
  CREATE INDEX "payment_attempts_provider_idx" ON "payment_attempts" USING btree ("provider");
  CREATE UNIQUE INDEX "payment_attempts_provider_order_id_idx" ON "payment_attempts" USING btree ("provider_order_id");
  CREATE UNIQUE INDEX "payment_attempts_provider_payment_id_idx" ON "payment_attempts" USING btree ("provider_payment_id");
  CREATE UNIQUE INDEX "payment_attempts_idempotency_key_idx" ON "payment_attempts" USING btree ("idempotency_key");
  CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts" USING btree ("status");
  CREATE INDEX "payment_attempts_updated_at_idx" ON "payment_attempts" USING btree ("updated_at");
  CREATE INDEX "payment_attempts_created_at_idx" ON "payment_attempts" USING btree ("created_at");
  CREATE INDEX "order_status_idx" ON "payment_attempts" USING btree ("order_id","status");
  CREATE INDEX "payment_webhook_events_provider_idx" ON "payment_webhook_events" USING btree ("provider");
  CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events" USING btree ("status");
  CREATE INDEX "payment_webhook_events_updated_at_idx" ON "payment_webhook_events" USING btree ("updated_at");
  CREATE INDEX "payment_webhook_events_created_at_idx" ON "payment_webhook_events" USING btree ("created_at");
  CREATE UNIQUE INDEX "provider_externalEventId_idx" ON "payment_webhook_events" USING btree ("provider","external_event_id");
  CREATE INDEX "coupon_redemptions_coupon_idx" ON "coupon_redemptions" USING btree ("coupon_id");
  CREATE INDEX "coupon_redemptions_customer_idx" ON "coupon_redemptions" USING btree ("customer_id");
  CREATE UNIQUE INDEX "coupon_redemptions_order_idx" ON "coupon_redemptions" USING btree ("order_id");
  CREATE INDEX "coupon_redemptions_status_idx" ON "coupon_redemptions" USING btree ("status");
  CREATE INDEX "coupon_redemptions_updated_at_idx" ON "coupon_redemptions" USING btree ("updated_at");
  CREATE INDEX "coupon_redemptions_created_at_idx" ON "coupon_redemptions" USING btree ("created_at");
  CREATE INDEX "coupon_customer_idx" ON "coupon_redemptions" USING btree ("coupon_id","customer_id");
  ALTER TABLE "carts" ADD CONSTRAINT "carts_converted_order_id_orders_id_fk" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_orders_fk" FOREIGN KEY ("orders_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_items_fk" FOREIGN KEY ("order_items_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_status_events_fk" FOREIGN KEY ("order_status_events_id") REFERENCES "public"."order_status_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_inventory_reservations_fk" FOREIGN KEY ("inventory_reservations_id") REFERENCES "public"."inventory_reservations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_payment_attempts_fk" FOREIGN KEY ("payment_attempts_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_payment_webhook_events_fk" FOREIGN KEY ("payment_webhook_events_id") REFERENCES "public"."payment_webhook_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_coupon_redemptions_fk" FOREIGN KEY ("coupon_redemptions_id") REFERENCES "public"."coupon_redemptions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "carts_converted_order_idx" ON "carts" USING btree ("converted_order_id");
  CREATE INDEX "payload_locked_documents_rels_orders_id_idx" ON "payload_locked_documents_rels" USING btree ("orders_id");
  CREATE INDEX "payload_locked_documents_rels_order_items_id_idx" ON "payload_locked_documents_rels" USING btree ("order_items_id");
  CREATE INDEX "payload_locked_documents_rels_order_status_events_id_idx" ON "payload_locked_documents_rels" USING btree ("order_status_events_id");
  CREATE INDEX "payload_locked_documents_rels_inventory_reservations_id_idx" ON "payload_locked_documents_rels" USING btree ("inventory_reservations_id");
  CREATE INDEX "payload_locked_documents_rels_payment_attempts_id_idx" ON "payload_locked_documents_rels" USING btree ("payment_attempts_id");
  CREATE INDEX "payload_locked_documents_rels_payment_webhook_events_id_idx" ON "payload_locked_documents_rels" USING btree ("payment_webhook_events_id");
  CREATE INDEX "payload_locked_documents_rels_coupon_redemptions_id_idx" ON "payload_locked_documents_rels" USING btree ("coupon_redemptions_id");
  ALTER TABLE "inventory" ADD CONSTRAINT "inventory_commerce_balance_check"
    CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand"
      AND "on_hand" = trunc("on_hand") AND "reserved" = trunc("reserved"));
  ALTER TABLE "orders" ADD CONSTRAINT "orders_money_check"
    CHECK (
      "items_subtotal_paise" >= 0 AND "discount_paise" >= 0 AND "shipping_paise" >= 0
      AND "tax_paise" >= 0 AND "cod_fee_paise" >= 0 AND "grand_total_paise" > 0
      AND "grand_total_paise" = "items_subtotal_paise" - "discount_paise" + "shipping_paise" + "tax_paise" + "cod_fee_paise"
    );
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_commerce_values_check"
    CHECK (
      "quantity" > 0 AND "quantity" = trunc("quantity")
      AND "unit_price_paise" >= 0 AND "unit_discount_paise" >= 0
      AND "line_subtotal_paise" >= 0 AND "line_discount_paise" >= 0
      AND "line_tax_paise" >= 0 AND "line_total_paise" >= 0
    );
  ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_quantity_check"
    CHECK ("quantity" > 0 AND "quantity" = trunc("quantity"));
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_check"
    CHECK ("amount_paise" > 0 AND "amount_paise" = trunc("amount_paise"));
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_amount_check"
    CHECK ("amount_paise" >= 0 AND "amount_paise" = trunc("amount_paise"));
  ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_values_check"
    CHECK (
      "free_shipping_above_paise" >= 0 AND "standard_fee_paise" >= 0
      AND "cod_fee_paise" >= 0 AND "handling_days" >= 0
    );`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "inventory" DROP CONSTRAINT IF EXISTS "inventory_commerce_balance_check";
  ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "order_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "order_status_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "inventory_reservations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payment_attempts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payment_webhook_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "coupon_redemptions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "shipping_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "orders" CASCADE;
  DROP TABLE "order_items" CASCADE;
  DROP TABLE "order_status_events" CASCADE;
  DROP TABLE "inventory_reservations" CASCADE;
  DROP TABLE "payment_attempts" CASCADE;
  DROP TABLE "payment_webhook_events" CASCADE;
  DROP TABLE "coupon_redemptions" CASCADE;
  DROP TABLE "shipping_settings" CASCADE;
  ALTER TABLE "carts" DROP CONSTRAINT "carts_converted_order_id_orders_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_orders_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_order_items_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_order_status_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_inventory_reservations_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_payment_attempts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_payment_webhook_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_coupon_redemptions_fk";
  
  DROP INDEX "carts_converted_order_idx";
  DROP INDEX "payload_locked_documents_rels_orders_id_idx";
  DROP INDEX "payload_locked_documents_rels_order_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_order_status_events_id_idx";
  DROP INDEX "payload_locked_documents_rels_inventory_reservations_id_idx";
  DROP INDEX "payload_locked_documents_rels_payment_attempts_id_idx";
  DROP INDEX "payload_locked_documents_rels_payment_webhook_events_id_idx";
  DROP INDEX "payload_locked_documents_rels_coupon_redemptions_id_idx";
  ALTER TABLE "carts" DROP COLUMN "converted_order_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "orders_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "order_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "order_status_events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "inventory_reservations_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "payment_attempts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "payment_webhook_events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "coupon_redemptions_id";
  DROP TYPE "public"."enum_orders_status";
  DROP TYPE "public"."enum_orders_payment_status";
  DROP TYPE "public"."enum_orders_fulfillment_status";
  DROP TYPE "public"."enum_orders_payment_method";
  DROP TYPE "public"."enum_orders_currency";
  DROP TYPE "public"."enum_order_status_events_from_status";
  DROP TYPE "public"."enum_order_status_events_to_status";
  DROP TYPE "public"."enum_order_status_events_actor_type";
  DROP TYPE "public"."enum_inventory_reservations_status";
  DROP TYPE "public"."enum_payment_attempts_provider";
  DROP TYPE "public"."enum_payment_attempts_payment_method";
  DROP TYPE "public"."enum_payment_attempts_currency";
  DROP TYPE "public"."enum_payment_attempts_status";
  DROP TYPE "public"."enum_payment_webhook_events_provider";
  DROP TYPE "public"."enum_payment_webhook_events_status";
  DROP TYPE "public"."enum_coupon_redemptions_status";
  DROP TYPE "public"."enum_shipping_settings_local_serviceability_mode";`)
}
