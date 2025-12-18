/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // `pending_registrations` jadvali mavjudligini tekshiramiz
    const hasPendingTable = await knex.schema.hasTable('pending_registrations');
    if (!hasPendingTable) {
      // Agar mavjud bo'lmasa, yaratamiz
      await knex.schema.createTable('pending_registrations', function(table) {
        table.increments('id').primary();
        table.integer('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
        table.text('user_data').notNullable();
        table.datetime('expires_at').notNullable();
      });
    }
  
    // `users` jadvalida `creds_message_id` ustuni mavjudligini tekshiramiz
    const hasCredsMessageIdColumn = await knex.schema.hasColumn('users', 'creds_message_id');
    if (!hasCredsMessageIdColumn) {
      // Agar mavjud bo'lmasa, qo'shamiz
      await knex.schema.table('users', function(table) {
        table.bigInteger('creds_message_id');
      });
    }
  
    // `users` jadvalida `must_delete_creds` ustuni mavjudligini tekshiramiz
    const hasMustDeleteCredsColumn = await knex.schema.hasColumn('users', 'must_delete_creds');
    if (!hasMustDeleteCredsColumn) {
      // Agar mavjud bo'lmasa, qo'shamiz
      await knex.schema.table('users', function(table) {
        table.boolean('must_delete_creds').defaultTo(false);
      });
    }
  };
  
  /**
   * @param { import("knex").Knex } knex
   * @returns { Promise<void> }
   */
  exports.down = async function(knex) {
    // `pending_registrations` jadvali mavjudligini tekshirib, keyin o'chiramiz
    const hasPendingTable = await knex.schema.hasTable('pending_registrations');
    if (hasPendingTable) {
      await knex.schema.dropTable('pending_registrations');
    }
  
    // `users` jadvalidagi ustunlarni mavjudligini tekshirib, keyin o'chiramiz
    const hasCredsMessageIdColumn = await knex.schema.hasColumn('users', 'creds_message_id');
    if (hasCredsMessageIdColumn) {
      await knex.schema.table('users', function(table) {
        table.dropColumn('creds_message_id');
      });
    }
  
    const hasMustDeleteCredsColumn = await knex.schema.hasColumn('users', 'must_delete_creds');
    if (hasMustDeleteCredsColumn) {
      await knex.schema.table('users', function(table) {
        table.dropColumn('must_delete_creds');
      });
    }
  };
  