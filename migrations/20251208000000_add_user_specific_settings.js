/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('user_specific_settings', function (table) {
    table.increments('id').primary();
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('role').notNullable();
    // null = ixtiyoriy, true = majburiy, false = ko'rsatilmaydi
    table.boolean('requires_locations').nullable();
    table.boolean('requires_brands').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Har bir foydalanuvchi uchun faqat bitta sozlama bo'lishi kerak
    table.unique(['user_id', 'role']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('user_specific_settings');
};

