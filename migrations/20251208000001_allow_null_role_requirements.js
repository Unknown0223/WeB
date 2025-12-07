// migrations/20251208000001_allow_null_role_requirements.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // SQLite'da ALTER COLUMN ishlamaydi, shuning uchun jadvalni qayta yaratish kerak
  // Lekin role_permissions jadvali roles jadvaliga reference qiladi, shuning uchun
  // avval foreign key constraint'ni olib tashlash, keyin jadvalni qayta yaratish, keyin constraint'ni qaytarish kerak
  
  return knex.transaction(async (trx) => {
    // 1. role_permissions jadvalidan foreign key constraint'ni olib tashlash (SQLite'da bu avtomatik)
    // 2. Yangi jadval yaratish (null qiymatlarni qo'llab-quvvatlash)
    await trx.raw(`
      CREATE TABLE roles_new (
        role_name TEXT PRIMARY KEY NOT NULL,
        requires_brands INTEGER,
        requires_locations INTEGER
      );
    `);
    
    // 3. Ma'lumotlarni ko'chirish
    await trx.raw(`
      INSERT INTO roles_new (role_name, requires_brands, requires_locations)
      SELECT role_name, requires_brands, requires_locations FROM roles;
    `);
    
    // 4. Eski jadvalni o'chirish
    await trx.raw(`DROP TABLE roles;`);
    
    // 5. Yangi jadvalni eski nomga o'zgartirish
    await trx.raw(`ALTER TABLE roles_new RENAME TO roles;`);
    
    // 6. role_permissions jadvali uchun foreign key constraint'ni qaytarish
    // SQLite'da bu avtomatik ishlaydi, chunki jadval nomi o'zgarmadi
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Qaytarish: notNullable() ni qaytarish
  return knex.schema.raw(`
    -- Yangi jadval yaratish
    CREATE TABLE roles_new (
      role_name TEXT PRIMARY KEY,
      requires_brands INTEGER NOT NULL DEFAULT 0,
      requires_locations INTEGER NOT NULL DEFAULT 0
    );
    
    -- Ma'lumotlarni ko'chirish (null qiymatlarni false ga o'zgartirish)
    INSERT INTO roles_new (role_name, requires_brands, requires_locations)
    SELECT 
      role_name, 
      COALESCE(requires_brands, 0) as requires_brands,
      COALESCE(requires_locations, 0) as requires_locations
    FROM roles;
    
    -- Eski jadvalni o'chirish
    DROP TABLE roles;
    
    -- Yangi jadvalni eski nomga o'zgartirish
    ALTER TABLE roles_new RENAME TO roles;
  `);
};

