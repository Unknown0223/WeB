// migrations/YYYYMMDDHHMMSS_add_meta_to_history.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  // Bu funksiya migratsiyani qo'llaydi
  return knex.schema.table('report_history', function(table) {
    // Hisobotning eski sanasini saqlash uchun ustun
    table.string('old_report_date');
    // Hisobotning eski filialini saqlash uchun ustun
    table.string('old_location');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Bu funksiya migratsiyani bekor qiladi (rollback)
  return knex.schema.table('report_history', function(table) {
    // O'zgarishlarni bekor qilish uchun ustunlarni o'chiramiz
    table.dropColumn('old_report_date');
    table.dropColumn('old_location');
  });
};
