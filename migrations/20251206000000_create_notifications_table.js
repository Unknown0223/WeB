/**
 * Create Notifications Table Migration
 * Bildirishnomalar uchun jadval
 * 
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Idempotent migration - jadval mavjudligini tekshirish
  const hasTable = await knex.schema.hasTable('notifications');
  
  if (!hasTable) {
    await knex.schema.createTable('notifications', function(table) {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('type', 50).notNullable(); // 'comparison_difference', 'report_late', etc.
      table.string('title', 255).notNullable();
      table.text('message').notNullable();
      table.text('details').nullable(); // JSON formatida batafsil ma'lumotlar
      table.boolean('is_read').defaultTo(false);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('read_at').nullable();
      
      // Indexes for better performance
      table.index('user_id', 'idx_notifications_user');
      table.index('is_read', 'idx_notifications_read');
      table.index('type', 'idx_notifications_type');
      table.index(['user_id', 'is_read'], 'idx_notifications_user_read');
      table.index('created_at', 'idx_notifications_created');
    });
  }
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('notifications');
};

