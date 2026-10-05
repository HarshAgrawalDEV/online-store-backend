import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Product search. pg_trgm ships with PostgreSQL and is available on Amazon RDS, so this
  // migration runs unchanged on a managed database. search_documents is derived data: it is
  // rebuilt from the catalogue (`pnpm search:reindex`) and is not a Payload collection.
  await db.execute(sql`
   CREATE EXTENSION IF NOT EXISTS pg_trgm;

   CREATE TABLE "search_documents" (
  	"product_id" integer PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"department" varchar NOT NULL,
  	"body" text NOT NULL,
  	"tsv" tsvector NOT NULL,
  	"min_price_paise" integer DEFAULT 0 NOT NULL,
  	"max_price_paise" integer DEFAULT 0 NOT NULL,
  	"in_stock" boolean DEFAULT false NOT NULL,
  	"is_featured" boolean DEFAULT false NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	CONSTRAINT "search_documents_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action
  );
  CREATE INDEX "search_documents_tsv_idx" ON "search_documents" USING gin ("tsv");
  CREATE INDEX "search_documents_body_trgm_idx" ON "search_documents" USING gin ("body" gin_trgm_ops);
  CREATE INDEX "search_documents_in_stock_idx" ON "search_documents" USING btree ("in_stock");`)

  await db.execute(sql`
   CREATE TABLE "search_synonyms_terms" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"term" varchar NOT NULL
  );
  
  CREATE TABLE "search_synonyms" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "search_queries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"query" varchar NOT NULL,
  	"normalized_query" varchar NOT NULL,
  	"result_count" numeric NOT NULL,
  	"relaxed" boolean DEFAULT false NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "search_synonyms_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "search_queries_id" integer;
  ALTER TABLE "search_synonyms_terms" ADD CONSTRAINT "search_synonyms_terms_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."search_synonyms"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "search_synonyms_terms_order_idx" ON "search_synonyms_terms" USING btree ("_order");
  CREATE INDEX "search_synonyms_terms_parent_id_idx" ON "search_synonyms_terms" USING btree ("_parent_id");
  CREATE INDEX "search_synonyms_is_active_idx" ON "search_synonyms" USING btree ("is_active");
  CREATE INDEX "search_synonyms_updated_at_idx" ON "search_synonyms" USING btree ("updated_at");
  CREATE INDEX "search_synonyms_created_at_idx" ON "search_synonyms" USING btree ("created_at");
  CREATE INDEX "search_queries_normalized_query_idx" ON "search_queries" USING btree ("normalized_query");
  CREATE INDEX "search_queries_result_count_idx" ON "search_queries" USING btree ("result_count");
  CREATE INDEX "search_queries_updated_at_idx" ON "search_queries" USING btree ("updated_at");
  CREATE INDEX "search_queries_created_at_idx" ON "search_queries" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_search_synonyms_fk" FOREIGN KEY ("search_synonyms_id") REFERENCES "public"."search_synonyms"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_search_queries_fk" FOREIGN KEY ("search_queries_id") REFERENCES "public"."search_queries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_search_synonyms_id_idx" ON "payload_locked_documents_rels" USING btree ("search_synonyms_id");
  CREATE INDEX "payload_locked_documents_rels_search_queries_id_idx" ON "payload_locked_documents_rels" USING btree ("search_queries_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE IF EXISTS "search_documents";`)
  // pg_trgm is left installed: other objects may use it.

  await db.execute(sql`
   ALTER TABLE "search_synonyms_terms" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "search_synonyms" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "search_queries" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "search_synonyms_terms" CASCADE;
  DROP TABLE "search_synonyms" CASCADE;
  DROP TABLE "search_queries" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_search_synonyms_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_search_queries_fk";
  
  DROP INDEX "payload_locked_documents_rels_search_synonyms_id_idx";
  DROP INDEX "payload_locked_documents_rels_search_queries_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "search_synonyms_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "search_queries_id";`)
}
