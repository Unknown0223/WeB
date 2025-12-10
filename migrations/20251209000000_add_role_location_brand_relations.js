// migrations/20251209000000_add_role_location_brand_relations.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Rol-Filial bog'lanish jadvali (by_location uchun)
    .createTable('role_locations', function(table) {
      table.increments('id').primary();
      table.string('role_name').notNullable().references('role_name').inTable('roles').onDelete('CASCADE');
      table.string('location_name').notNullable();
      table.unique(['role_name', 'location_name']);
    })
    // Rol-Brend bog'lanish jadvali (by_brand uchun)
    .createTable('role_brands', function(table) {
      table.increments('id').primary();
      table.string('role_name').notNullable().references('role_name').inTable('roles').onDelete('CASCADE');
      table.integer('brand_id').notNullable().references('id').inTable('brands').onDelete('CASCADE');
      table.unique(['role_name', 'brand_id']);
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

