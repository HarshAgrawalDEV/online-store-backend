import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_customers_status" AS ENUM('active', 'suspended');
  CREATE TYPE "public"."enum_customer_addresses_state_code" AS ENUM('AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CG', 'DH', 'DL', 'GA', 'GJ', 'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK', 'UP', 'WB');
  CREATE TYPE "public"."enum_customer_addresses_country_code" AS ENUM('IN');
  CREATE TYPE "public"."enum_customer_addresses_address_type" AS ENUM('home', 'work', 'other');
  CREATE TYPE "public"."enum_carts_status" AS ENUM('active', 'converted', 'abandoned', 'expired');
  CREATE TYPE "public"."enum_carts_currency" AS ENUM('INR');
  CREATE TYPE "public"."enum_promotions_discount_type" AS ENUM('percentage', 'fixed');
  CREATE TYPE "public"."enum_promotions_status" AS ENUM('draft', 'active', 'paused', 'expired');
  CREATE TYPE "public"."enum_coupons_status" AS ENUM('active', 'disabled');
  CREATE TABLE "customers_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "customers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"first_name" varchar NOT NULL,
  	"last_name" varchar,
  	"phone_number" varchar,
  	"phone_verified" boolean DEFAULT false NOT NULL,
  	"status" "enum_customers_status" DEFAULT 'active' NOT NULL,
  	"last_login_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "customer_addresses" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"recipient_name" varchar NOT NULL,
  	"phone_number" varchar NOT NULL,
  	"line1" varchar NOT NULL,
  	"line2" varchar,
  	"landmark" varchar,
  	"city" varchar NOT NULL,
  	"state_code" "enum_customer_addresses_state_code" NOT NULL,
  	"pincode" varchar NOT NULL,
  	"country_code" "enum_customer_addresses_country_code" DEFAULT 'IN' NOT NULL,
  	"address_type" "enum_customer_addresses_address_type" DEFAULT 'home' NOT NULL,
  	"is_default" boolean DEFAULT false NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "wishlists" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"name" varchar DEFAULT 'Saved Items' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "wishlist_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"wishlist_id" integer NOT NULL,
  	"product_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "carts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"status" "enum_carts_status" DEFAULT 'active' NOT NULL,
  	"currency" "enum_carts_currency" DEFAULT 'INR' NOT NULL,
  	"coupon_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cart_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"cart_id" integer NOT NULL,
  	"variant_id" integer NOT NULL,
  	"quantity" numeric DEFAULT 1 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "promotions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"description" varchar,
  	"discount_type" "enum_promotions_discount_type" NOT NULL,
  	"discount_value" numeric NOT NULL,
  	"max_discount_paise" numeric,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"status" "enum_promotions_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "promotions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"categories_id" integer
  );
  
  CREATE TABLE "coupons" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"description" varchar,
  	"promotion_id" integer NOT NULL,
  	"status" "enum_coupons_status" DEFAULT 'active' NOT NULL,
  	"usage_limit" numeric,
  	"per_customer_limit" numeric DEFAULT 1,
  	"minimum_cart_paise" numeric DEFAULT 0,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "customers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "customer_addresses_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "wishlists_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "wishlist_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "carts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "cart_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "promotions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "coupons_id" integer;
  ALTER TABLE "payload_preferences_rels" ADD COLUMN "customers_id" integer;
  ALTER TABLE "customers_sessions" ADD CONSTRAINT "customers_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "carts" ADD CONSTRAINT "carts_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "promotions_rels" ADD CONSTRAINT "promotions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promotions_rels" ADD CONSTRAINT "promotions_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promotions_rels" ADD CONSTRAINT "promotions_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "coupons" ADD CONSTRAINT "coupons_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "customers_sessions_order_idx" ON "customers_sessions" USING btree ("_order");
  CREATE INDEX "customers_sessions_parent_id_idx" ON "customers_sessions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "customers_phone_number_idx" ON "customers" USING btree ("phone_number");
  CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");
  CREATE INDEX "customers_updated_at_idx" ON "customers" USING btree ("updated_at");
  CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");
  CREATE UNIQUE INDEX "customers_email_idx" ON "customers" USING btree ("email");
  CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");
  CREATE INDEX "customer_addresses_pincode_idx" ON "customer_addresses" USING btree ("pincode");
  CREATE INDEX "customer_addresses_is_active_idx" ON "customer_addresses" USING btree ("is_active");
  CREATE INDEX "customer_addresses_updated_at_idx" ON "customer_addresses" USING btree ("updated_at");
  CREATE INDEX "customer_addresses_created_at_idx" ON "customer_addresses" USING btree ("created_at");
  CREATE INDEX "customer_isDefault_idx" ON "customer_addresses" USING btree ("customer_id","is_default");
  CREATE UNIQUE INDEX "wishlists_customer_idx" ON "wishlists" USING btree ("customer_id");
  CREATE INDEX "wishlists_updated_at_idx" ON "wishlists" USING btree ("updated_at");
  CREATE INDEX "wishlists_created_at_idx" ON "wishlists" USING btree ("created_at");
  CREATE INDEX "wishlist_items_wishlist_idx" ON "wishlist_items" USING btree ("wishlist_id");
  CREATE INDEX "wishlist_items_product_idx" ON "wishlist_items" USING btree ("product_id");
  CREATE INDEX "wishlist_items_updated_at_idx" ON "wishlist_items" USING btree ("updated_at");
  CREATE INDEX "wishlist_items_created_at_idx" ON "wishlist_items" USING btree ("created_at");
  CREATE UNIQUE INDEX "wishlist_product_idx" ON "wishlist_items" USING btree ("wishlist_id","product_id");
  CREATE INDEX "carts_customer_idx" ON "carts" USING btree ("customer_id");
  CREATE INDEX "carts_status_idx" ON "carts" USING btree ("status");
  CREATE INDEX "carts_coupon_idx" ON "carts" USING btree ("coupon_id");
  CREATE INDEX "carts_updated_at_idx" ON "carts" USING btree ("updated_at");
  CREATE INDEX "carts_created_at_idx" ON "carts" USING btree ("created_at");
  CREATE INDEX "customer_status_idx" ON "carts" USING btree ("customer_id","status");
  CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");
  CREATE INDEX "cart_items_variant_idx" ON "cart_items" USING btree ("variant_id");
  CREATE INDEX "cart_items_updated_at_idx" ON "cart_items" USING btree ("updated_at");
  CREATE INDEX "cart_items_created_at_idx" ON "cart_items" USING btree ("created_at");
  CREATE UNIQUE INDEX "cart_variant_idx" ON "cart_items" USING btree ("cart_id","variant_id");
  CREATE INDEX "promotions_starts_at_idx" ON "promotions" USING btree ("starts_at");
  CREATE INDEX "promotions_ends_at_idx" ON "promotions" USING btree ("ends_at");
  CREATE INDEX "promotions_status_idx" ON "promotions" USING btree ("status");
  CREATE INDEX "promotions_updated_at_idx" ON "promotions" USING btree ("updated_at");
  CREATE INDEX "promotions_created_at_idx" ON "promotions" USING btree ("created_at");
  CREATE INDEX "promotions_rels_order_idx" ON "promotions_rels" USING btree ("order");
  CREATE INDEX "promotions_rels_parent_idx" ON "promotions_rels" USING btree ("parent_id");
  CREATE INDEX "promotions_rels_path_idx" ON "promotions_rels" USING btree ("path");
  CREATE INDEX "promotions_rels_products_id_idx" ON "promotions_rels" USING btree ("products_id");
  CREATE INDEX "promotions_rels_categories_id_idx" ON "promotions_rels" USING btree ("categories_id");
  CREATE UNIQUE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");
  CREATE INDEX "coupons_promotion_idx" ON "coupons" USING btree ("promotion_id");
  CREATE INDEX "coupons_status_idx" ON "coupons" USING btree ("status");
  CREATE INDEX "coupons_starts_at_idx" ON "coupons" USING btree ("starts_at");
  CREATE INDEX "coupons_ends_at_idx" ON "coupons" USING btree ("ends_at");
  CREATE INDEX "coupons_updated_at_idx" ON "coupons" USING btree ("updated_at");
  CREATE INDEX "coupons_created_at_idx" ON "coupons" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customer_addresses_fk" FOREIGN KEY ("customer_addresses_id") REFERENCES "public"."customer_addresses"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_wishlists_fk" FOREIGN KEY ("wishlists_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_wishlist_items_fk" FOREIGN KEY ("wishlist_items_id") REFERENCES "public"."wishlist_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_carts_fk" FOREIGN KEY ("carts_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_cart_items_fk" FOREIGN KEY ("cart_items_id") REFERENCES "public"."cart_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_promotions_fk" FOREIGN KEY ("promotions_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_coupons_fk" FOREIGN KEY ("coupons_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "payload_locked_documents_rels" USING btree ("customers_id");
  CREATE INDEX "payload_locked_documents_rels_customer_addresses_id_idx" ON "payload_locked_documents_rels" USING btree ("customer_addresses_id");
  CREATE INDEX "payload_locked_documents_rels_wishlists_id_idx" ON "payload_locked_documents_rels" USING btree ("wishlists_id");
  CREATE INDEX "payload_locked_documents_rels_wishlist_items_id_idx" ON "payload_locked_documents_rels" USING btree ("wishlist_items_id");
  CREATE INDEX "payload_locked_documents_rels_carts_id_idx" ON "payload_locked_documents_rels" USING btree ("carts_id");
  CREATE INDEX "payload_locked_documents_rels_cart_items_id_idx" ON "payload_locked_documents_rels" USING btree ("cart_items_id");
  CREATE INDEX "payload_locked_documents_rels_promotions_id_idx" ON "payload_locked_documents_rels" USING btree ("promotions_id");
  CREATE INDEX "payload_locked_documents_rels_coupons_id_idx" ON "payload_locked_documents_rels" USING btree ("coupons_id");
  CREATE INDEX "payload_preferences_rels_customers_id_idx" ON "payload_preferences_rels" USING btree ("customers_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "customers_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "customers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "customer_addresses" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "wishlists" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "wishlist_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "carts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cart_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promotions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promotions_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "coupons" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "customers_sessions" CASCADE;
  DROP TABLE "customers" CASCADE;
  DROP TABLE "customer_addresses" CASCADE;
  DROP TABLE "wishlists" CASCADE;
  DROP TABLE "wishlist_items" CASCADE;
  DROP TABLE "carts" CASCADE;
  DROP TABLE "cart_items" CASCADE;
  DROP TABLE "promotions" CASCADE;
  DROP TABLE "promotions_rels" CASCADE;
  DROP TABLE "coupons" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_customers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_customer_addresses_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_wishlists_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_wishlist_items_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_carts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_cart_items_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_promotions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_coupons_fk";
  
  ALTER TABLE "payload_preferences_rels" DROP CONSTRAINT "payload_preferences_rels_customers_fk";
  
  DROP INDEX "payload_locked_documents_rels_customers_id_idx";
  DROP INDEX "payload_locked_documents_rels_customer_addresses_id_idx";
  DROP INDEX "payload_locked_documents_rels_wishlists_id_idx";
  DROP INDEX "payload_locked_documents_rels_wishlist_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_carts_id_idx";
  DROP INDEX "payload_locked_documents_rels_cart_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_promotions_id_idx";
  DROP INDEX "payload_locked_documents_rels_coupons_id_idx";
  DROP INDEX "payload_preferences_rels_customers_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "customers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "customer_addresses_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "wishlists_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "wishlist_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "carts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "cart_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "promotions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "coupons_id";
  ALTER TABLE "payload_preferences_rels" DROP COLUMN "customers_id";
  DROP TYPE "public"."enum_customers_status";
  DROP TYPE "public"."enum_customer_addresses_state_code";
  DROP TYPE "public"."enum_customer_addresses_country_code";
  DROP TYPE "public"."enum_customer_addresses_address_type";
  DROP TYPE "public"."enum_carts_status";
  DROP TYPE "public"."enum_carts_currency";
  DROP TYPE "public"."enum_promotions_discount_type";
  DROP TYPE "public"."enum_promotions_status";
  DROP TYPE "public"."enum_coupons_status";`)
}
