import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_set_details_product_type" AS ENUM('kada_pair', 'bangle_set', 'complete_set', 'chuda_set');
  CREATE TABLE "materials" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"code" varchar NOT NULL,
  	"is_premium" boolean DEFAULT false NOT NULL,
  	"description" varchar,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sizes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"label" varchar NOT NULL,
  	"inner_diameter_mm" numeric,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "colours" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"code" varchar NOT NULL,
  	"short_code" varchar,
  	"swatch_hex" varchar,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"note" varchar,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "occasions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "catalog_attribute_definitions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "catalog_attribute_options" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_occasions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "product_variants_option_values" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "catalog_attribute_definitions" CASCADE;
  DROP TABLE "catalog_attribute_options" CASCADE;
  DROP TABLE "products_occasions" CASCADE;
  DROP TABLE "product_variants_option_values" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_catalog_attribute_definitio_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_catalog_attribute_options_fk";
  
  DROP INDEX IF EXISTS "products_jewelry_details_jewelry_details_material_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_catalog_attribute_definiti_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_catalog_attribute_options__idx";
  ALTER TABLE "products" ADD COLUMN "design_number" numeric;
  ALTER TABLE "products" ADD COLUMN "ai_draft_text" varchar;
  ALTER TABLE "products" ADD COLUMN "ai_draft_model" varchar;
  ALTER TABLE "products" ADD COLUMN "ai_draft_generated_at" timestamp(3) with time zone;
  ALTER TABLE "products" ADD COLUMN "material_id" integer;
  ALTER TABLE "products" ADD COLUMN "set_details_product_type" "enum_products_set_details_product_type";
  ALTER TABLE "products" ADD COLUMN "set_details_pieces_total" numeric;
  ALTER TABLE "products" ADD COLUMN "set_details_kada_count" numeric;
  ALTER TABLE "products_rels" ADD COLUMN "occasions_id" integer;
  ALTER TABLE "product_variants" ADD COLUMN "size_id" integer;
  ALTER TABLE "product_variants" ADD COLUMN "colour_id" integer;
  ALTER TABLE "product_variants" ADD COLUMN "custom_colour_name" varchar;
  ALTER TABLE "product_variants" ADD COLUMN "save_to_colour_library" boolean DEFAULT false;
  ALTER TABLE "product_variants" ADD COLUMN "size_label" varchar;
  ALTER TABLE "product_variants" ADD COLUMN "colour_label" varchar;
  ALTER TABLE "order_items" ADD COLUMN "description_snapshot" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "materials_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sizes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "colours_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "occasions_id" integer;
  CREATE UNIQUE INDEX "materials_name_idx" ON "materials" USING btree ("name");
  CREATE UNIQUE INDEX "materials_slug_idx" ON "materials" USING btree ("slug");
  CREATE UNIQUE INDEX "materials_code_idx" ON "materials" USING btree ("code");
  CREATE INDEX "materials_is_active_idx" ON "materials" USING btree ("is_active");
  CREATE INDEX "materials_updated_at_idx" ON "materials" USING btree ("updated_at");
  CREATE INDEX "materials_created_at_idx" ON "materials" USING btree ("created_at");
  CREATE UNIQUE INDEX "sizes_code_idx" ON "sizes" USING btree ("code");
  CREATE INDEX "sizes_is_active_idx" ON "sizes" USING btree ("is_active");
  CREATE INDEX "sizes_updated_at_idx" ON "sizes" USING btree ("updated_at");
  CREATE INDEX "sizes_created_at_idx" ON "sizes" USING btree ("created_at");
  CREATE UNIQUE INDEX "colours_code_idx" ON "colours" USING btree ("code");
  CREATE INDEX "colours_is_active_idx" ON "colours" USING btree ("is_active");
  CREATE INDEX "colours_updated_at_idx" ON "colours" USING btree ("updated_at");
  CREATE INDEX "colours_created_at_idx" ON "colours" USING btree ("created_at");
  CREATE UNIQUE INDEX "occasions_name_idx" ON "occasions" USING btree ("name");
  CREATE UNIQUE INDEX "occasions_slug_idx" ON "occasions" USING btree ("slug");
  CREATE INDEX "occasions_is_active_idx" ON "occasions" USING btree ("is_active");
  CREATE INDEX "occasions_updated_at_idx" ON "occasions" USING btree ("updated_at");
  CREATE INDEX "occasions_created_at_idx" ON "occasions" USING btree ("created_at");
  ALTER TABLE "products" ADD CONSTRAINT "products_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_occasions_fk" FOREIGN KEY ("occasions_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_size_id_sizes_id_fk" FOREIGN KEY ("size_id") REFERENCES "public"."sizes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_colour_id_colours_id_fk" FOREIGN KEY ("colour_id") REFERENCES "public"."colours"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_materials_fk" FOREIGN KEY ("materials_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sizes_fk" FOREIGN KEY ("sizes_id") REFERENCES "public"."sizes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_colours_fk" FOREIGN KEY ("colours_id") REFERENCES "public"."colours"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_occasions_fk" FOREIGN KEY ("occasions_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "products_design_number_idx" ON "products" USING btree ("design_number");
  CREATE INDEX "products_material_idx" ON "products" USING btree ("material_id");
  CREATE INDEX "products_set_details_set_details_product_type_idx" ON "products" USING btree ("set_details_product_type");
  CREATE INDEX "products_rels_occasions_id_idx" ON "products_rels" USING btree ("occasions_id");
  CREATE INDEX "product_variants_size_idx" ON "product_variants" USING btree ("size_id");
  CREATE INDEX "product_variants_colour_idx" ON "product_variants" USING btree ("colour_id");
  CREATE INDEX "payload_locked_documents_rels_materials_id_idx" ON "payload_locked_documents_rels" USING btree ("materials_id");
  CREATE INDEX "payload_locked_documents_rels_sizes_id_idx" ON "payload_locked_documents_rels" USING btree ("sizes_id");
  CREATE INDEX "payload_locked_documents_rels_colours_id_idx" ON "payload_locked_documents_rels" USING btree ("colours_id");
  CREATE INDEX "payload_locked_documents_rels_occasions_id_idx" ON "payload_locked_documents_rels" USING btree ("occasions_id");
  ALTER TABLE "products" DROP COLUMN "jewelry_details_material";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "catalog_attribute_definitions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "catalog_attribute_options_id";
  DROP TYPE "public"."enum_catalog_attribute_definitions_scope";
  DROP TYPE "public"."enum_catalog_attribute_definitions_value_type";
  DROP TYPE "public"."enum_products_occasions_occasion";

  -- Design numbers: one running number across the store, never reused.
  CREATE SEQUENCE IF NOT EXISTS product_design_number_seq START 1;

  -- Sets are always for both hands: even, whole piece counts; kadas never exceed the total.
  ALTER TABLE "products" ADD CONSTRAINT "products_set_pieces_check"
    CHECK ("set_details_pieces_total" IS NULL OR ("set_details_pieces_total" >= 2 AND "set_details_pieces_total" = trunc("set_details_pieces_total") AND mod("set_details_pieces_total", 2) = 0));
  ALTER TABLE "products" ADD CONSTRAINT "products_set_kadas_check"
    CHECK ("set_details_kada_count" IS NULL OR ("set_details_kada_count" >= 0 AND "set_details_kada_count" = trunc("set_details_kada_count") AND ("set_details_pieces_total" IS NULL OR "set_details_kada_count" <= "set_details_pieces_total")));
  ALTER TABLE "sizes" ADD CONSTRAINT "sizes_inner_diameter_check"
    CHECK ("inner_diameter_mm" IS NULL OR "inner_diameter_mm" > 0);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sizes" DROP CONSTRAINT IF EXISTS "sizes_inner_diameter_check";
  ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_set_kadas_check";
  ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_set_pieces_check";
  DROP SEQUENCE IF EXISTS product_design_number_seq;
  CREATE TYPE "public"."enum_catalog_attribute_definitions_scope" AS ENUM('product', 'variant');
  CREATE TYPE "public"."enum_catalog_attribute_definitions_value_type" AS ENUM('select', 'multi_select', 'text');
  CREATE TYPE "public"."enum_products_occasions_occasion" AS ENUM('wedding', 'haldi', 'mehendi', 'diwali', 'festive', 'everyday', 'gifting');
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
  
  CREATE TABLE "products_occasions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"occasion" "enum_products_occasions_occasion" NOT NULL
  );
  
  CREATE TABLE "product_variants_option_values" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"attribute_id" integer NOT NULL,
  	"option_id" integer NOT NULL
  );
  
  ALTER TABLE "materials" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sizes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "colours" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "occasions" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "materials" CASCADE;
  DROP TABLE "sizes" CASCADE;
  DROP TABLE "colours" CASCADE;
  DROP TABLE "occasions" CASCADE;
  ALTER TABLE "products" DROP CONSTRAINT "products_material_id_materials_id_fk";
  
  ALTER TABLE "products_rels" DROP CONSTRAINT "products_rels_occasions_fk";
  
  ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_size_id_sizes_id_fk";
  
  ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_colour_id_colours_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_materials_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sizes_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_colours_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_occasions_fk";
  
  DROP INDEX "products_design_number_idx";
  DROP INDEX "products_material_idx";
  DROP INDEX "products_set_details_set_details_product_type_idx";
  DROP INDEX "products_rels_occasions_id_idx";
  DROP INDEX "product_variants_size_idx";
  DROP INDEX "product_variants_colour_idx";
  DROP INDEX "payload_locked_documents_rels_materials_id_idx";
  DROP INDEX "payload_locked_documents_rels_sizes_id_idx";
  DROP INDEX "payload_locked_documents_rels_colours_id_idx";
  DROP INDEX "payload_locked_documents_rels_occasions_id_idx";
  ALTER TABLE "products" ADD COLUMN "jewelry_details_material" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "catalog_attribute_definitions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "catalog_attribute_options_id" integer;
  ALTER TABLE "catalog_attribute_options" ADD CONSTRAINT "catalog_attribute_options_attribute_id_catalog_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."catalog_attribute_definitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_occasions" ADD CONSTRAINT "products_occasions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_variants_option_values" ADD CONSTRAINT "product_variants_option_values_attribute_id_catalog_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."catalog_attribute_definitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants_option_values" ADD CONSTRAINT "product_variants_option_values_option_id_catalog_attribute_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."catalog_attribute_options"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants_option_values" ADD CONSTRAINT "product_variants_option_values_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "catalog_attribute_definitions_code_idx" ON "catalog_attribute_definitions" USING btree ("code");
  CREATE INDEX "catalog_attribute_definitions_updated_at_idx" ON "catalog_attribute_definitions" USING btree ("updated_at");
  CREATE INDEX "catalog_attribute_definitions_created_at_idx" ON "catalog_attribute_definitions" USING btree ("created_at");
  CREATE INDEX "catalog_attribute_options_attribute_idx" ON "catalog_attribute_options" USING btree ("attribute_id");
  CREATE INDEX "catalog_attribute_options_updated_at_idx" ON "catalog_attribute_options" USING btree ("updated_at");
  CREATE INDEX "catalog_attribute_options_created_at_idx" ON "catalog_attribute_options" USING btree ("created_at");
  CREATE UNIQUE INDEX "attribute_code_idx" ON "catalog_attribute_options" USING btree ("attribute_id","code");
  CREATE INDEX "products_occasions_order_idx" ON "products_occasions" USING btree ("_order");
  CREATE INDEX "products_occasions_parent_id_idx" ON "products_occasions" USING btree ("_parent_id");
  CREATE INDEX "product_variants_option_values_order_idx" ON "product_variants_option_values" USING btree ("_order");
  CREATE INDEX "product_variants_option_values_parent_id_idx" ON "product_variants_option_values" USING btree ("_parent_id");
  CREATE INDEX "product_variants_option_values_attribute_idx" ON "product_variants_option_values" USING btree ("attribute_id");
  CREATE INDEX "product_variants_option_values_option_idx" ON "product_variants_option_values" USING btree ("option_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_catalog_attribute_definitio_fk" FOREIGN KEY ("catalog_attribute_definitions_id") REFERENCES "public"."catalog_attribute_definitions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_catalog_attribute_options_fk" FOREIGN KEY ("catalog_attribute_options_id") REFERENCES "public"."catalog_attribute_options"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "products_jewelry_details_jewelry_details_material_idx" ON "products" USING btree ("jewelry_details_material");
  CREATE INDEX "payload_locked_documents_rels_catalog_attribute_definiti_idx" ON "payload_locked_documents_rels" USING btree ("catalog_attribute_definitions_id");
  CREATE INDEX "payload_locked_documents_rels_catalog_attribute_options__idx" ON "payload_locked_documents_rels" USING btree ("catalog_attribute_options_id");
  ALTER TABLE "products" DROP COLUMN "design_number";
  ALTER TABLE "products" DROP COLUMN "ai_draft_text";
  ALTER TABLE "products" DROP COLUMN "ai_draft_model";
  ALTER TABLE "products" DROP COLUMN "ai_draft_generated_at";
  ALTER TABLE "products" DROP COLUMN "material_id";
  ALTER TABLE "products" DROP COLUMN "set_details_product_type";
  ALTER TABLE "products" DROP COLUMN "set_details_pieces_total";
  ALTER TABLE "products" DROP COLUMN "set_details_kada_count";
  ALTER TABLE "products_rels" DROP COLUMN "occasions_id";
  ALTER TABLE "product_variants" DROP COLUMN "size_id";
  ALTER TABLE "product_variants" DROP COLUMN "colour_id";
  ALTER TABLE "product_variants" DROP COLUMN "custom_colour_name";
  ALTER TABLE "product_variants" DROP COLUMN "save_to_colour_library";
  ALTER TABLE "product_variants" DROP COLUMN "size_label";
  ALTER TABLE "product_variants" DROP COLUMN "colour_label";
  ALTER TABLE "order_items" DROP COLUMN "description_snapshot";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "materials_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sizes_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "colours_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "occasions_id";
  DROP TYPE "public"."enum_products_set_details_product_type";`)
}
