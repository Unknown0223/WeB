/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.table('ostatki_imports', function(table) {
    table.decimal('summa', 15, 2).nullable(); // Summa ixtiyoriy maydon
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.table('ostatki_imports', function(table) {
    table.dropColumn('summa');
  });
};

