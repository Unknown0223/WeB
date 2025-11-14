// migrations/YYYYMMDDHHMMSS_add_timestamps_to_users.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.table('users', function(table) {
      // Yaratilgan vaqt uchun ustun (standart qiymat - hozirgi vaqt)
      table.timestamp('created_at').defaultTo(knex.fn.now());
      // Yangilangan vaqt uchun ustun
      table.timestamp('updated_at');
    });
  };
  
  /**
   * @param { import("knex").Knex } knex
   * @returns { Promise<void> }
   */
  exports.down = function(knex) {
    return knex.schema.table('users', function(table) {
      // O'zgarishlarni bekor qilish uchun ustunlarni o'chiramiz
      table.dropColumn('created_at');
      table.dropColumn('updated_at');
    });
  };
  