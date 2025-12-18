/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('products', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('smart_code').notNullable().unique();
    table.string('category').nullable();
    table.decimal('price_estimate', 15, 2).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('smart_code');
    table.index('category');
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('products');
};

