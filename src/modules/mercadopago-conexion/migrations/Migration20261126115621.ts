import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261126115621 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "mercadopago_conexion" add column if not exists "sello" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "mercadopago_conexion" drop column if exists "sello";`);
  }

}
