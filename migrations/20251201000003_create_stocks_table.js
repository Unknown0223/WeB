/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('stocks', function(table) {
    table.increments('id').primary();
    table.integer('branch_id').unsigned().references('id').inTable('branches').onDelete('CASCADE');
    table.integer('product_id').unsigned().references('id').inTable('products').onDelete('CASCADE');
    table.integer('current_stock').notNullable().defaultTo(0);
    table.integer('reserved_stock').nullable().defaultTo(0);
    table.integer('available_for_sale').nullable(); // Computed: current_stock - reserved_stock
    table.timestamp('last_updated').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Unique constraint: one stock record per branch+product
    table.unique(['branch_id', 'product_id']);
    
    // Indexes
    table.index('branch_id');
    table.index('product_id');
    table.index('current_stock');
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('stocks');
};

