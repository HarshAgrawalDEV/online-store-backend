import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_media_kind" AS ENUM('product', 'lifestyle', 'editorial', 'review', 'other');
  CREATE TYPE "public"."enum_collections_occasion" AS ENUM('wedding', 'haldi', 'mehendi', 'diwali', 'festive', 'everyday', 'gifting');
  CREATE TYPE "public"."enum_catalog_attribute_definitions_scope" AS ENUM('product', 'variant');
  CREATE TYPE "public"."enum_catalog_attribute_definitions_value_type" AS ENUM('select', 'multi_select', 'text');
  CREATE TYPE "public"."enum_products_occasions_occasion" AS ENUM('wedding', 'haldi', 'mehendi', 'diwali', 'festive', 'everyday', 'gifting');
  CREATE TYPE "public"."enum_products_status" AS ENUM('draft', 'active', 'archived');
  CREATE TYPE "public"."enum_products_tax_class" AS ENUM('standard', 'exempt', 'custom');
  CREATE TYPE "public"."enum_product_variants_status" AS ENUM('active', 'inactive', 'discontinued');
  CREATE TYPE "public"."enum_inventory_stock_status" AS ENUM('available', 'out_of_stock', 'paused');
  CREATE TYPE "public"."enum_inventory_movements_reason" AS ENUM('initial_stock', 'manual_adjustment', 'order_fulfilled', 'order_cancelled', 'return_restock', 'damage');
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"caption" varchar,
  	"kind" "enum_media_kind" DEFAULT 'product' NOT NULL,
  	"photographer_credit" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_thumbnail_url" varchar,
  	"sizes_thumbnail_width" numeric,
  	"sizes_thumbnail_height" numeric,
  	"sizes_thumbnail_mime_type" varchar,
  	"sizes_thumbnail_filesize" numeric,
  	"sizes_thumbnail_filename" varchar,
  	"sizes_card_url" varchar,
  	"sizes_card_width" numeric,
  	"sizes_card_height" numeric,
  	"sizes_card_mime_type" varchar,
  	"sizes_card_filesize" numeric,
  	"sizes_card_filename" varchar,
  	"sizes_hero_url" varchar,
  	"sizes_hero_width" numeric,
  	"sizes_hero_height" numeric,
  	"sizes_hero_mime_type" varchar,
  	"sizes_hero_filesize" numeric,
  	"sizes_hero_filename" varchar
  );
  
  CREATE TABLE "categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"parent_id" integer,
  	"image_id" integer,
  	"description" varchar,
  	"sort_order" numeric DEFAULT 0,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "collections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"summary" varchar,
  	"hero_image_id" integer,
  	"occasion" "enum_collections_occasion",
  	"is_published" boolean DEFAULT false NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "catalog_attribute_definitions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"code" varchar NOT NULL,
  	"scope" "enum_catalog_attribute_definitions_scope" NOT NULL,
  	"value_type" "enum_catalog_attribute_definitions_value_type" NOT NULL,
  	"filterable" boolean DEFAULT false NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "catalog_attribute_options" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"attribute_id" integer NOT NULL,
  	"code" varchar NOT NULL,
  	"label" varchar NOT NULL,
  	"swatch_hex" varchar,
  	"sort_order" numeric DEFAULT 0,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products_style_tags" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "products_occasions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"occasion" "enum_products_occasions_occasion" NOT NULL
  );
  
  CREATE TABLE "products_specifications" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"value" varchar NOT NULL
  );
  
  CREATE TABLE "products_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"variant_id" integer,
  	"caption" varchar,
  	"sort_order" numeric DEFAULT 0 NOT NULL
  );
  
  CREATE TABLE "products" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"short_description" varchar,
  	"description" jsonb,
  	"status" "enum_products_status" DEFAULT 'draft' NOT NULL,
  	"primary_category_id" integer NOT NULL,
  	"jewelry_details_brand" varchar DEFAULT 'Rajasthan Jewelry',
  	"jewelry_details_material" varchar,
  	"jewelry_details_plating" varchar,
  	"jewelry_details_stone_type" varchar,
  	"care_instructions" jsonb,
  	"is_returnable" boolean DEFAULT true NOT NULL,
  	"return_window_days" numeric,
  	"weight_grams" numeric,
  	"hsn_code" varchar,
  	"tax_class" "enum_products_tax_class",
  	"featured_image_id" integer,
  	"is_featured" boolean DEFAULT false NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"categories_id" integer,
  	"collections_id" integer
  );
  
  CREATE TABLE "product_variants_option_values" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"attribute_id" integer NOT NULL,
  	"option_id" integer NOT NULL
  );
  
  CREATE TABLE "product_variants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"sku" varchar NOT NULL,
  	"option_signature" varchar NOT NULL,
  	"size_code" varchar,
  	"color_code" varchar,
  	"finish_code" varchar,
  	"price_paise" numeric NOT NULL,
  	"compare_at_price_paise" numeric,
  	"cost_paise" numeric,
  	"status" "enum_product_variants_status" DEFAULT 'active' NOT NULL,
  	"barcode" varchar,
  	"weight_grams" numeric,
  	"image_id" integer,
  	"max_per_order" numeric DEFAULT 10,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "inventory" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"on_hand" numeric DEFAULT 0 NOT NULL,
  	"reserved" numeric DEFAULT 0 NOT NULL,
  	"reorder_point" numeric DEFAULT 0,
  	"stock_status" "enum_inventory_stock_status" DEFAULT 'available' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "inventory_movements" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"quantity_delta" numeric NOT NULL,
  	"reason" "enum_inventory_movements_reason" NOT NULL,
  	"reference_type" varchar,
  	"reference_id" varchar,
  	"performed_by_id" integer,
  	"note" varchar,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "media_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "categories_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "collections_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "catalog_attribute_definitions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "catalog_attribute_options_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "products_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "product_variants_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "inventory_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "inventory_movements_id" integer;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections" ADD CONSTRAINT "collections_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "catalog_attribute_options" ADD CONSTRAINT "catalog_attribute_options_attribute_id_catalog_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."catalog_attribute_definitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_style_tags" ADD CONSTRAINT "products_style_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_occasions" ADD CONSTRAINT "products_occasions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_specifications" ADD CONSTRAINT "products_specifications_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_primary_category_id_categories_id_fk" FOREIGN KEY ("primary_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_featured_image_id_media_id_fk" FOREIGN KEY ("featured_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_variants_option_values" ADD CONSTRAINT "product_variants_option_values_attribute_id_catalog_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."catalog_attribute_definitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants_option_values" ADD CONSTRAINT "product_variants_option_values_option_id_catalog_attribute_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."catalog_attribute_options"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants_option_values" ADD CONSTRAINT "product_variants_option_values_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_performed_by_id_admins_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "media_sizes_card_sizes_card_filename_idx" ON "media" USING btree ("sizes_card_filename");
  CREATE INDEX "media_sizes_hero_sizes_hero_filename_idx" ON "media" USING btree ("sizes_hero_filename");
  CREATE INDEX "categories_name_idx" ON "categories" USING btree ("name");
  CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");
  CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");
  CREATE INDEX "categories_image_idx" ON "categories" USING btree ("image_id");
  CREATE INDEX "categories_is_active_idx" ON "categories" USING btree ("is_active");
  CREATE INDEX "categories_updated_at_idx" ON "categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "categories" USING btree ("created_at");
  CREATE UNIQUE INDEX "collections_slug_idx" ON "collections" USING btree ("slug");
  CREATE INDEX "collections_hero_image_idx" ON "collections" USING btree ("hero_image_id");
  CREATE INDEX "collections_occasion_idx" ON "collections" USING btree ("occasion");
  CREATE INDEX "collections_is_published_idx" ON "collections" USING btree ("is_published");
  CREATE INDEX "collections_updated_at_idx" ON "collections" USING btree ("updated_at");
  CREATE INDEX "collections_created_at_idx" ON "collections" USING btree ("created_at");
  CREATE UNIQUE INDEX "catalog_attribute_definitions_code_idx" ON "catalog_attribute_definitions" USING btree ("code");
  CREATE INDEX "catalog_attribute_definitions_updated_at_idx" ON "catalog_attribute_definitions" USING btree ("updated_at");
  CREATE INDEX "catalog_attribute_definitions_created_at_idx" ON "catalog_attribute_definitions" USING btree ("created_at");
  CREATE INDEX "catalog_attribute_options_attribute_idx" ON "catalog_attribute_options" USING btree ("attribute_id");
  CREATE INDEX "catalog_attribute_options_updated_at_idx" ON "catalog_attribute_options" USING btree ("updated_at");
  CREATE INDEX "catalog_attribute_options_created_at_idx" ON "catalog_attribute_options" USING btree ("created_at");
  CREATE UNIQUE INDEX "attribute_code_idx" ON "catalog_attribute_options" USING btree ("attribute_id","code");
  CREATE INDEX "products_style_tags_order_idx" ON "products_style_tags" USING btree ("_order");
  CREATE INDEX "products_style_tags_parent_id_idx" ON "products_style_tags" USING btree ("_parent_id");
  CREATE INDEX "products_occasions_order_idx" ON "products_occasions" USING btree ("_order");
  CREATE INDEX "products_occasions_parent_id_idx" ON "products_occasions" USING btree ("_parent_id");
  CREATE INDEX "products_specifications_order_idx" ON "products_specifications" USING btree ("_order");
  CREATE INDEX "products_specifications_parent_id_idx" ON "products_specifications" USING btree ("_parent_id");
  CREATE INDEX "products_gallery_order_idx" ON "products_gallery" USING btree ("_order");
  CREATE INDEX "products_gallery_parent_id_idx" ON "products_gallery" USING btree ("_parent_id");
  CREATE INDEX "products_gallery_image_idx" ON "products_gallery" USING btree ("image_id");
  CREATE INDEX "products_gallery_variant_idx" ON "products_gallery" USING btree ("variant_id");
  CREATE INDEX "products_name_idx" ON "products" USING btree ("name");
  CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");
  CREATE INDEX "products_status_idx" ON "products" USING btree ("status");
  CREATE INDEX "products_primary_category_idx" ON "products" USING btree ("primary_category_id");
  CREATE INDEX "products_jewelry_details_jewelry_details_material_idx" ON "products" USING btree ("jewelry_details_material");
  CREATE INDEX "products_featured_image_idx" ON "products" USING btree ("featured_image_id");
  CREATE INDEX "products_is_featured_idx" ON "products" USING btree ("is_featured");
  CREATE INDEX "products_published_at_idx" ON "products" USING btree ("published_at");
  CREATE INDEX "products_updated_at_idx" ON "products" USING btree ("updated_at");
  CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");
  CREATE INDEX "status_primaryCategory_publishedAt_idx" ON "products" USING btree ("status","primary_category_id","published_at");
  CREATE INDEX "products_rels_order_idx" ON "products_rels" USING btree ("order");
  CREATE INDEX "products_rels_parent_idx" ON "products_rels" USING btree ("parent_id");
  CREATE INDEX "products_rels_path_idx" ON "products_rels" USING btree ("path");
  CREATE INDEX "products_rels_categories_id_idx" ON "products_rels" USING btree ("categories_id");
  CREATE INDEX "products_rels_collections_id_idx" ON "products_rels" USING btree ("collections_id");
  CREATE INDEX "product_variants_option_values_order_idx" ON "product_variants_option_values" USING btree ("_order");
  CREATE INDEX "product_variants_option_values_parent_id_idx" ON "product_variants_option_values" USING btree ("_parent_id");
  CREATE INDEX "product_variants_option_values_attribute_idx" ON "product_variants_option_values" USING btree ("attribute_id");
  CREATE INDEX "product_variants_option_values_option_idx" ON "product_variants_option_values" USING btree ("option_id");
  CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");
  CREATE UNIQUE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");
  CREATE INDEX "product_variants_color_code_idx" ON "product_variants" USING btree ("color_code");
  CREATE INDEX "product_variants_price_paise_idx" ON "product_variants" USING btree ("price_paise");
  CREATE INDEX "product_variants_status_idx" ON "product_variants" USING btree ("status");
  CREATE UNIQUE INDEX "product_variants_barcode_idx" ON "product_variants" USING btree ("barcode");
  CREATE INDEX "product_variants_image_idx" ON "product_variants" USING btree ("image_id");
  CREATE INDEX "product_variants_updated_at_idx" ON "product_variants" USING btree ("updated_at");
  CREATE INDEX "product_variants_created_at_idx" ON "product_variants" USING btree ("created_at");
  CREATE UNIQUE INDEX "product_optionSignature_idx" ON "product_variants" USING btree ("product_id","option_signature");
  CREATE INDEX "product_status_idx" ON "product_variants" USING btree ("product_id","status");
  CREATE UNIQUE INDEX "inventory_variant_idx" ON "inventory" USING btree ("variant_id");
  CREATE INDEX "inventory_stock_status_idx" ON "inventory" USING btree ("stock_status");
  CREATE INDEX "inventory_updated_at_idx" ON "inventory" USING btree ("updated_at");
  CREATE INDEX "inventory_created_at_idx" ON "inventory" USING btree ("created_at");
  CREATE INDEX "inventory_movements_variant_idx" ON "inventory_movements" USING btree ("variant_id");
  CREATE INDEX "inventory_movements_performed_by_idx" ON "inventory_movements" USING btree ("performed_by_id");
  CREATE INDEX "inventory_movements_occurred_at_idx" ON "inventory_movements" USING btree ("occurred_at");
  CREATE INDEX "inventory_movements_updated_at_idx" ON "inventory_movements" USING btree ("updated_at");
  CREATE INDEX "inventory_movements_created_at_idx" ON "inventory_movements" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_catalog_attribute_definitio_fk" FOREIGN KEY ("catalog_attribute_definitions_id") REFERENCES "public"."catalog_attribute_definitions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_catalog_attribute_options_fk" FOREIGN KEY ("catalog_attribute_options_id") REFERENCES "public"."catalog_attribute_options"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_variants_fk" FOREIGN KEY ("product_variants_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_inventory_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_inventory_movements_fk" FOREIGN KEY ("inventory_movements_id") REFERENCES "public"."inventory_movements"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_collections_id_idx" ON "payload_locked_documents_rels" USING btree ("collections_id");
  CREATE INDEX "payload_locked_documents_rels_catalog_attribute_definiti_idx" ON "payload_locked_documents_rels" USING btree ("catalog_attribute_definitions_id");
  CREATE INDEX "payload_locked_documents_rels_catalog_attribute_options__idx" ON "payload_locked_documents_rels" USING btree ("catalog_attribute_options_id");
  CREATE INDEX "payload_locked_documents_rels_products_id_idx" ON "payload_locked_documents_rels" USING btree ("products_id");
  CREATE INDEX "payload_locked_documents_rels_product_variants_id_idx" ON "payload_locked_documents_rels" USING btree ("product_variants_id");
  CREATE INDEX "payload_locked_documents_rels_inventory_id_idx" ON "payload_locked_documents_rels" USING btree ("inventory_id");
  CREATE INDEX "payload_locked_documents_rels_inventory_movements_id_idx" ON "payload_locked_documents_rels" USING btree ("inventory_movements_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "catalog_attribute_definitions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "catalog_attribute_options" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_style_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_occasions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_specifications" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "product_variants_option_values" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "product_variants" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "inventory" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "inventory_movements" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "media" CASCADE;
  DROP TABLE "categories" CASCADE;
  DROP TABLE "collections" CASCADE;
  DROP TABLE "catalog_attribute_definitions" CASCADE;
  DROP TABLE "catalog_attribute_options" CASCADE;
  DROP TABLE "products_style_tags" CASCADE;
  DROP TABLE "products_occasions" CASCADE;
  DROP TABLE "products_specifications" CASCADE;
  DROP TABLE "products_gallery" CASCADE;
  DROP TABLE "products" CASCADE;
  DROP TABLE "products_rels" CASCADE;
  DROP TABLE "product_variants_option_values" CASCADE;
  DROP TABLE "product_variants" CASCADE;
  DROP TABLE "inventory" CASCADE;
  DROP TABLE "inventory_movements" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_media_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_categories_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_collections_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_catalog_attribute_definitio_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_catalog_attribute_options_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_products_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_product_variants_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_inventory_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_inventory_movements_fk";
  
  DROP INDEX "payload_locked_documents_rels_media_id_idx";
  DROP INDEX "payload_locked_documents_rels_categories_id_idx";
  DROP INDEX "payload_locked_documents_rels_collections_id_idx";
  DROP INDEX "payload_locked_documents_rels_catalog_attribute_definiti_idx";
  DROP INDEX "payload_locked_documents_rels_catalog_attribute_options__idx";
  DROP INDEX "payload_locked_documents_rels_products_id_idx";
  DROP INDEX "payload_locked_documents_rels_product_variants_id_idx";
  DROP INDEX "payload_locked_documents_rels_inventory_id_idx";
  DROP INDEX "payload_locked_documents_rels_inventory_movements_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "media_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "categories_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "collections_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "catalog_attribute_definitions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "catalog_attribute_options_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "products_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "product_variants_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "inventory_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "inventory_movements_id";
  DROP TYPE "public"."enum_media_kind";
  DROP TYPE "public"."enum_collections_occasion";
  DROP TYPE "public"."enum_catalog_attribute_definitions_scope";
  DROP TYPE "public"."enum_catalog_attribute_definitions_value_type";
  DROP TYPE "public"."enum_products_occasions_occasion";
  DROP TYPE "public"."enum_products_status";
  DROP TYPE "public"."enum_products_tax_class";
  DROP TYPE "public"."enum_product_variants_status";
  DROP TYPE "public"."enum_inventory_stock_status";
  DROP TYPE "public"."enum_inventory_movements_reason";`)
}
