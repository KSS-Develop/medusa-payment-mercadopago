import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261126113832 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "mercadopago_conexion" drop constraint if exists "mercadopago_conexion_pais_unique";`);
    this.addSql(`create table if not exists "mercadopago_conexion" ("id" text not null, "pais" text not null, "user_id" text null, "access_token" text null, "refresh_token" text null, "public_key" text null, "expira_en" timestamptz null, "live_mode" boolean not null default true, "origen" text null, "pendiente_estado" text null, "pendiente_verificador" text null, "pendiente_hasta" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mercadopago_conexion_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mercadopago_conexion_pais_unique" ON "mercadopago_conexion" ("pais") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mercadopago_conexion_deleted_at" ON "mercadopago_conexion" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "mercadopago_conexion" cascade;`);
  }

}
