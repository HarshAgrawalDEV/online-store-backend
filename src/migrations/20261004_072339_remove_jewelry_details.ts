import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "jewelry_details_brand";
  ALTER TABLE "products" DROP COLUMN "jewelry_details_plating";
  ALTER TABLE "products" DROP COLUMN "jewelry_details_stone_type";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" ADD COLUMN "jewelry_details_brand" varchar DEFAULT 'Rajasthan Jewelry';
  ALTER TABLE "products" ADD COLUMN "jewelry_details_plating" varchar;
  ALTER TABLE "products" ADD COLUMN "jewelry_details_stone_type" varchar;`)
}
