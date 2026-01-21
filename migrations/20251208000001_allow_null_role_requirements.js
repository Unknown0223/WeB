// migrations/20251208000001_allow_null_role_requirements.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Database client turini aniqlash
  const client = knex.client.config.client;
  const isPostgres = client === 'pg';
  
  if (isPostgres) {
    // PostgreSQL'da ALTER COLUMN ishlatish
    return knex.schema.table('roles', function(table) {
      // Boolean ustunlarini nullable qilish
      table.boolean('requires_brands').nullable().alter();
      table.boolean('requires_locations').nullable().alter();
    });
  } else {
    // SQLite'da ALTER COLUMN ishlamaydi, shuning uchun jadvalni qayta yaratish kerak
    return knex.transaction(async (trx) => {
      // 1. Yangi jadval yaratish (null qiymatlarni qo'llab-quvvatlash)
      await trx.raw(`
        CREATE TABLE roles_new (
          role_name TEXT PRIMARY KEY NOT NULL,
          requires_brands INTEGER,
          requires_locations INTEGER
        );
      `);
      
      // 2. Ma'lumotlarni ko'chirish (boolean ni integer ga konvertatsiya)
      await trx.raw(`
        INSERT INTO roles_new (role_name, requires_brands, requires_locations)
        SELECT 
          role_name, 
          CASE WHEN requires_brands THEN 1 ELSE 0 END as requires_brands,
          CASE WHEN requires_locations THEN 1 ELSE 0 END as requires_locations
        FROM roles;
      `);
      
      // 3. Eski jadvalni o'chirish
      await trx.raw(`DROP TABLE roles;`);
      
      // 4. Yangi jadvalni eski nomga o'zgartirish
      await trx.raw(`ALTER TABLE roles_new RENAME TO roles;`);
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Database client turini aniqlash
  const client = knex.client.config.client;
  const isPostgres = client === 'pg';
  
  if (isPostgres) {
    // PostgreSQL'da ALTER COLUMN ishlatish
    return knex.schema.table('roles', function(table) {
      // Boolean ustunlarini notNullable qilish
      table.boolean('requires_brands').defaultTo(false).notNullable().alter();
      table.boolean('requires_locations').defaultTo(false).notNullable().alter();
    });
  } else {
    // SQLite uchun eski usul
    return knex.schema.raw(`
      CREATE TABLE roles_new (
        role_name TEXT PRIMARY KEY,
        requires_brands INTEGER NOT NULL DEFAULT 0,
        requires_locations INTEGER NOT NULL DEFAULT 0
      );
      
      INSERT INTO roles_new (role_name, requires_brands, requires_locations)
      SELECT 
        role_name, 
        COALESCE(requires_brands, 0) as requires_brands,
        COALESCE(requires_locations, 0) as requires_locations
      FROM roles;
      
      DROP TABLE roles;
      ALTER TABLE roles_new RENAME TO roles;
    `);
  }
};

