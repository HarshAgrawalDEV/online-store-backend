import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_categories_department" AS ENUM('bangles', 'jewellery');
  CREATE TYPE "public"."enum_products_department" AS ENUM('bangles', 'jewellery');
  CREATE TYPE "public"."enum_products_jewellery_wear" AS ENUM('pierced', 'clip_on', 'both');
  CREATE TYPE "public"."enum_products_jewellery_fit" AS ENUM('adjustable', 'fixed');
  CREATE TYPE "public"."enum_products_jewellery_base_metal" AS ENUM('brass', 'copper', 'alloy', 'other');
  CREATE TABLE "piece_types" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"sold_as_pair" boolean DEFAULT false NOT NULL,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "jewellery_styles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "finishes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "stone_types" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products_jewellery_components" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"piece_id" integer,
  	"quantity" numeric DEFAULT 1
  );
  
  ALTER TABLE "categories" ADD COLUMN "department" "enum_categories_department" DEFAULT 'bangles' NOT NULL;
  ALTER TABLE "categories" ADD COLUMN "sku_code" varchar;
  ALTER TABLE "products" ADD COLUMN "department" "enum_products_department" DEFAULT 'bangles' NOT NULL;
  ALTER TABLE "products" ADD COLUMN "jewellery_finish_id" integer;
  ALTER TABLE "products" ADD COLUMN "jewellery_wear" "enum_products_jewellery_wear";
  ALTER TABLE "products" ADD COLUMN "jewellery_fit" "enum_products_jewellery_fit";
  ALTER TABLE "products" ADD COLUMN "jewellery_base_metal" "enum_products_jewellery_base_metal";
  ALTER TABLE "products_rels" ADD COLUMN "jewellery_styles_id" integer;
  ALTER TABLE "products_rels" ADD COLUMN "stone_types_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "piece_types_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "jewellery_styles_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "finishes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "stone_types_id" integer;
  ALTER TABLE "products_jewellery_components" ADD CONSTRAINT "products_jewellery_components_piece_id_piece_types_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."piece_types"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_jewellery_components" ADD CONSTRAINT "products_jewellery_components_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "piece_types_name_idx" ON "piece_types" USING btree ("name");
  CREATE UNIQUE INDEX "piece_types_slug_idx" ON "piece_types" USING btree ("slug");
  CREATE INDEX "piece_types_is_active_idx" ON "piece_types" USING btree ("is_active");
  CREATE INDEX "piece_types_updated_at_idx" ON "piece_types" USING btree ("updated_at");
  CREATE INDEX "piece_types_created_at_idx" ON "piece_types" USING btree ("created_at");
  CREATE UNIQUE INDEX "jewellery_styles_name_idx" ON "jewellery_styles" USING btree ("name");
  CREATE UNIQUE INDEX "jewellery_styles_slug_idx" ON "jewellery_styles" USING btree ("slug");
  CREATE INDEX "jewellery_styles_is_active_idx" ON "jewellery_styles" USING btree ("is_active");
  CREATE INDEX "jewellery_styles_updated_at_idx" ON "jewellery_styles" USING btree ("updated_at");
  CREATE INDEX "jewellery_styles_created_at_idx" ON "jewellery_styles" USING btree ("created_at");
  CREATE UNIQUE INDEX "finishes_name_idx" ON "finishes" USING btree ("name");
  CREATE UNIQUE INDEX "finishes_slug_idx" ON "finishes" USING btree ("slug");
  CREATE INDEX "finishes_is_active_idx" ON "finishes" USING btree ("is_active");
  CREATE INDEX "finishes_updated_at_idx" ON "finishes" USING btree ("updated_at");
  CREATE INDEX "finishes_created_at_idx" ON "finishes" USING btree ("created_at");
  CREATE UNIQUE INDEX "stone_types_name_idx" ON "stone_types" USING btree ("name");
  CREATE UNIQUE INDEX "stone_types_slug_idx" ON "stone_types" USING btree ("slug");
  CREATE INDEX "stone_types_is_active_idx" ON "stone_types" USING btree ("is_active");
  CREATE INDEX "stone_types_updated_at_idx" ON "stone_types" USING btree ("updated_at");
  CREATE INDEX "stone_types_created_at_idx" ON "stone_types" USING btree ("created_at");
  CREATE INDEX "products_jewellery_components_order_idx" ON "products_jewellery_components" USING btree ("_order");
  CREATE INDEX "products_jewellery_components_parent_id_idx" ON "products_jewellery_components" USING btree ("_parent_id");
  CREATE INDEX "products_jewellery_components_piece_idx" ON "products_jewellery_components" USING btree ("piece_id");
  ALTER TABLE "products" ADD CONSTRAINT "products_jewellery_finish_id_finishes_id_fk" FOREIGN KEY ("jewellery_finish_id") REFERENCES "public"."finishes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_jewellery_styles_fk" FOREIGN KEY ("jewellery_styles_id") REFERENCES "public"."jewellery_styles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_stone_types_fk" FOREIGN KEY ("stone_types_id") REFERENCES "public"."stone_types"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_piece_types_fk" FOREIGN KEY ("piece_types_id") REFERENCES "public"."piece_types"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_jewellery_styles_fk" FOREIGN KEY ("jewellery_styles_id") REFERENCES "public"."jewellery_styles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_finishes_fk" FOREIGN KEY ("finishes_id") REFERENCES "public"."finishes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stone_types_fk" FOREIGN KEY ("stone_types_id") REFERENCES "public"."stone_types"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "categories_department_idx" ON "categories" USING btree ("department");
  CREATE INDEX "products_department_idx" ON "products" USING btree ("department");
  CREATE INDEX "products_jewellery_jewellery_finish_idx" ON "products" USING btree ("jewellery_finish_id");
  CREATE INDEX "products_rels_jewellery_styles_id_idx" ON "products_rels" USING btree ("jewellery_styles_id");
  CREATE INDEX "products_rels_stone_types_id_idx" ON "products_rels" USING btree ("stone_types_id");
  CREATE INDEX "payload_locked_documents_rels_piece_types_id_idx" ON "payload_locked_documents_rels" USING btree ("piece_types_id");
  CREATE INDEX "payload_locked_documents_rels_jewellery_styles_id_idx" ON "payload_locked_documents_rels" USING btree ("jewellery_styles_id");
  CREATE INDEX "payload_locked_documents_rels_finishes_id_idx" ON "payload_locked_documents_rels" USING btree ("finishes_id");
  CREATE INDEX "payload_locked_documents_rels_stone_types_id_idx" ON "payload_locked_documents_rels" USING btree ("stone_types_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "piece_types" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "jewellery_styles" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "finishes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "stone_types" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_jewellery_components" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "piece_types" CASCADE;
  DROP TABLE "jewellery_styles" CASCADE;
  DROP TABLE "finishes" CASCADE;
  DROP TABLE "stone_types" CASCADE;
  DROP TABLE "products_jewellery_components" CASCADE;
  ALTER TABLE "products" DROP CONSTRAINT "products_jewellery_finish_id_finishes_id_fk";
  
  ALTER TABLE "products_rels" DROP CONSTRAINT "products_rels_jewellery_styles_fk";
  
  ALTER TABLE "products_rels" DROP CONSTRAINT "products_rels_stone_types_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_piece_types_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_jewellery_styles_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_finishes_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_stone_types_fk";
  
  DROP INDEX "categories_department_idx";
  DROP INDEX "products_department_idx";
  DROP INDEX "products_jewellery_jewellery_finish_idx";
  DROP INDEX "products_rels_jewellery_styles_id_idx";
  DROP INDEX "products_rels_stone_types_id_idx";
  DROP INDEX "payload_locked_documents_rels_piece_types_id_idx";
  DROP INDEX "payload_locked_documents_rels_jewellery_styles_id_idx";
  DROP INDEX "payload_locked_documents_rels_finishes_id_idx";
  DROP INDEX "payload_locked_documents_rels_stone_types_id_idx";
  ALTER TABLE "categories" DROP COLUMN "department";
  ALTER TABLE "categories" DROP COLUMN "sku_code";
  ALTER TABLE "products" DROP COLUMN "department";
  ALTER TABLE "products" DROP COLUMN "jewellery_finish_id";
  ALTER TABLE "products" DROP COLUMN "jewellery_wear";
  ALTER TABLE "products" DROP COLUMN "jewellery_fit";
  ALTER TABLE "products" DROP COLUMN "jewellery_base_metal";
  ALTER TABLE "products_rels" DROP COLUMN "jewellery_styles_id";
  ALTER TABLE "products_rels" DROP COLUMN "stone_types_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "piece_types_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "jewellery_styles_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "finishes_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "stone_types_id";
  DROP TYPE "public"."enum_categories_department";
  DROP TYPE "public"."enum_products_department";
  DROP TYPE "public"."enum_products_jewellery_wear";
  DROP TYPE "public"."enum_products_jewellery_fit";
  DROP TYPE "public"."enum_products_jewellery_base_metal";`)
}
