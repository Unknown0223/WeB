/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('ostatki_analysis', function(table) {
    table.increments('id').primary();
    table.string('smart_code').notNullable();
    table.string('product_name').notNullable();
    table.string('filial').notNullable();
    table.integer('current_stock').notNullable().defaultTo(0);
    table.integer('total_sold').notNullable().defaultTo(0);
    table.integer('total_bonus').notNullable().defaultTo(0);
    table.date('first_sale_date');
    table.date('last_sale_date');
    table.integer('days_count');
    table.decimal('daily_average', 10, 2);
    table.integer('days_remaining');
    table.string('alert_status'); // 'critical', 'warning', 'ok'
    table.string('alert_message');
    table.timestamp('calculated_at').defaultTo(knex.fn.now());
    table.integer('calculated_by').references('id').inTable('users').onDelete('SET NULL');
    
    // Indexes for better performance
    table.index(['smart_code', 'filial']);
    table.index(['alert_status']);
    table.index(['filial']);
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('ostatki_analysis');
};

