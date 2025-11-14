/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // 1. Vaqtinchalik ro'yxatdan o'tish ma'lumotlarini saqlash uchun yangi jadval
    .createTable('pending_registrations', function(table) {
      table.increments('id').primary();
      // Bu user_id `users` jadvalidagi ID bilan bog'lanadi
      table.integer('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
      // Foydalanuvchining asl ma'lumotlari (parol, maxfiy so'z) JSON formatida saqlanadi
      table.text('user_data').notNullable();
      // Bu yozuv qachon eskirishini belgilaydi (masalan, 15 daqiqadan so'ng)
      table.datetime('expires_at').notNullable();
    })
    // 2. `users` jadvaliga yangi ustunlar qo'shish
    .table('users', function(table) {
      // Foydalanuvchiga yuborilgan kirish ma'lumotlari xabarining ID'si
      table.bigInteger('creds_message_id');
      // Foydalanuvchi birinchi marta kirganda xabarni o'chirish kerakligi haqida belgi
      table.boolean('must_delete_creds').defaultTo(false);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    // O'zgarishlarni teskari tartibda bekor qilish
    .table('users', function(table) {
      table.dropColumn('creds_message_id');
      table.dropColumn('must_delete_creds');
    })
    .dropTableIfExists('pending_registrations');
};
