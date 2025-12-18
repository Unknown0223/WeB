/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('imports', function(table) {
    table.increments('id').primary();
    table.string('file_name').notNullable();
    table.string('type').notNullable(); // 'sales' or 'stock'
    table.timestamp('uploaded_at').defaultTo(knex.fn.now());
    table.string('status').notNullable().defaultTo('pending'); // 'pending', 'processing', 'completed', 'failed'
    table.text('errors').nullable(); // JSON array of errors
    table.integer('rows_imported').nullable().defaultTo(0);
    table.integer('rows_failed').nullable().defaultTo(0);
    table.integer('uploaded_by').unsigned().nullable(); // User ID if users table exists
    table.text('metadata').nullable(); // JSON metadata
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('imports');
};

