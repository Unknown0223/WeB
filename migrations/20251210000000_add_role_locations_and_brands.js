// migrations/20251210000000_add_role_locations_and_brands.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('role_locations', function (table) {
      table.string('role_name').references('role_name').inTable('roles').onDelete('CASCADE');
      table.string('location_name').notNullable();
      table.primary(['role_name', 'location_name']);
    })
    .createTable('role_brands', function (table) {
      table.string('role_name').references('role_name').inTable('roles').onDelete('CASCADE');
      table.integer('brand_id').references('id').inTable('brands').onDelete('CASCADE');
      table.primary(['role_name', 'brand_id']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('role_brands')
    .dropTableIfExists('role_locations');
};

