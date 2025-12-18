/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('sales', function(table) {
    table.increments('id').primary();
    table.integer('branch_id').unsigned().references('id').inTable('branches').onDelete('CASCADE');
    table.integer('product_id').unsigned().references('id').inTable('products').onDelete('CASCADE');
    table.date('date').notNullable(); // ISO format: YYYY-MM-DD
    table.integer('quantity_sold').notNullable().defaultTo(0);
    table.decimal('sale_amount', 15, 2).notNullable().defaultTo(0);
    table.decimal('bonus_given', 15, 2).nullable().defaultTo(0);
    table.string('ticket_id').nullable();
    table.string('invoice_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Indexes for performance
    table.index('branch_id');
    table.index('product_id');
    table.index('date');
    table.index(['branch_id', 'product_id', 'date']); // Composite index for common queries
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sales');
};

