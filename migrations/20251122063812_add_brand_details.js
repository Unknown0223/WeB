/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('brands', (table) => {
    table.string('color', 7).defaultTo('#4facfe'); // Hex rang kodi
    table.string('emoji', 10).defaultTo('🏢'); // Emoji/icon
    table.text('description'); // Tavsif
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('brands', (table) => {
    table.dropColumn('color');
    table.dropColumn('emoji');
    table.dropColumn('description');
  });
};
