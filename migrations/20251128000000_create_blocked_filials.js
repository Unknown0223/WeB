/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('blocked_filials', function(table) {
    table.increments('id').primary();
    table.string('filial_name').notNullable().unique();
    table.text('reason').nullable(); // Bloklash sababi
    table.integer('blocked_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('blocked_at').defaultTo(knex.fn.now());
    table.timestamp('unblocked_at').nullable();
    table.boolean('is_active').defaultTo(true);
    
    table.index(['filial_name']);
    table.index(['is_active']);
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('blocked_filials');
};

