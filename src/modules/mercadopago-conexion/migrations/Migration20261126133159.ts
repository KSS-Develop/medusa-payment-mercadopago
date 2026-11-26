import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261126133159 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "mercadopago_conexion" add column if not exists "modo" text not null default 'oauth', add column if not exists "webhook_secret" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "mercadopago_conexion" drop column if exists "modo", drop column if exists "webhook_secret";`);
  }

}
