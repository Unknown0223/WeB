/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('debt_requests', table => {
    table.string('excel_file_path').nullable().comment('Excel fayl yo\'li (agar mavjud bo\'lsa)');
    table.text('excel_data').nullable().comment('JSON formatida Excel ma\'lumotlari');
    table.decimal('excel_total', 15, 2).nullable().comment('Excel fayldagi jami summa');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('debt_requests', table => {
    table.dropColumn('excel_file_path');
    table.dropColumn('excel_data');
    table.dropColumn('excel_total');
  });
};
