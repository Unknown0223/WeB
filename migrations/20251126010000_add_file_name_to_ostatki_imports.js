/**
 * @param { import('knex').Knex } knex
 */
exports.up = function(knex) {
  return knex.schema.alterTable('ostatki_imports', function(table) {
    table.string('file_name').nullable(); // Import qilingan fayl nomi
    table.string('import_type').nullable(); // 'savdo' yoki 'ostatka'
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.alterTable('ostatki_imports', function(table) {
    table.dropColumn('file_name');
    table.dropColumn('import_type');
  });
};

