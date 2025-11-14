/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.table('users', function(table) {
      // Foydalanuvchining botga ulanganligini bildiruvchi ustun.
      // Bu ustun `telegram_chat_id` mavjudligiga qarab avtomatik yangilanadi.
      table.boolean('is_telegram_connected').notNullable().defaultTo(false);
    })
    .then(() => {
      // Mavjud foydalanuvchilar uchun statusni to'g'rilab chiqamiz.
      // Agar telegram_chat_id bo'lsa, demak ulangan.
      return knex('users')
        .whereNotNull('telegram_chat_id')
        .update({ is_telegram_connected: true });
    });
  };
  
  /**
   * @param { import("knex").Knex } knex
   * @returns { Promise<void> }
   */
  exports.down = function(knex) {
    return knex.schema.table('users', function(table) {
      table.dropColumn('is_telegram_connected');
    });
  };
  