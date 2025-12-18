/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('ostatki_imports', function(table) {
    table.increments('id').primary();
    table.string('product_code');
    table.string('product_name');
    table.string('filial');
    table.integer('day');
    table.string('month');
    table.integer('year');
    table.integer('bonus');
    table.integer('quantity');
    table.timestamp('imported_at').defaultTo(knex.fn.now());
    table.string('imported_by'); // ixtiyoriy: kim yukladi
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('ostatki_imports');
};
