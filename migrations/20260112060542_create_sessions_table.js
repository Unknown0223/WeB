/**
 * Sessions table for connect-pg-simple (express-session PostgreSQL store)
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('sessions', function(table) {
    table.string('sid').primary();
    table.json('sess').notNullable();
    table.timestamp('expire').notNullable().index();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sessions');
};
