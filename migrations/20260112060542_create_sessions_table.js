/**
 * Sessions table for express-session (PostgreSQL uchun)
 * SQLite uchun connect-sqlite3 o'zi jadvalni yaratadi
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const client = knex.client.config.client;
  const isPostgres = client === 'pg';
  
  // Faqat PostgreSQL uchun migration
  if (!isPostgres) {
    // SQLite uchun - connect-sqlite3 o'zi jadvalni yaratadi
    // Migration o'tkazib yuboriladi
    return;
  }
  
  const hasSessionsTable = await knex.schema.hasTable('sessions');
  
  if (hasSessionsTable) {
    // Jadval allaqachon mavjud, o'tkazib yuborish
    return;
  }
  
  // PostgreSQL uchun - connect-pg-simple `expire` ustunini ishlatadi
  return knex.schema.createTable('sessions', function(table) {
    table.string('sid').primary();
    table.json('sess').notNullable();
    table.timestamp('expire').notNullable().index();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sessions');
};
