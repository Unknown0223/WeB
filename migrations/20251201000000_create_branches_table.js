/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.createTable('branches', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.string('region').nullable();
    table.text('meta').nullable(); // JSON metadata
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('branches');
};

