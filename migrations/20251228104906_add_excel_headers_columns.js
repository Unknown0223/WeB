/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('debt_requests', table => {
    table.text('excel_headers').nullable().comment('Excel fayl headerlari (JSON array)');
    table.text('excel_columns').nullable().comment('Excel fayl ustun mapping (JSON object)');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('debt_requests', table => {
    table.dropColumn('excel_headers');
    table.dropColumn('excel_columns');
  });
};
