// migrations/20251206120000_add_role_requirements.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('roles', function (table) {
    table.boolean('requires_brands').defaultTo(false).notNullable();
    table.boolean('requires_locations').defaultTo(false).notNullable();
  }).then(() => {
    // Faqat super_admin roli mavjud bo'lishi kerak, boshqa rollar superadmin tomonidan yaratiladi
    // Shuning uchun faqat super_admin roli uchun shartlarni o'rnatamiz
    return knex('roles').where('role_name', 'super_admin').update({ requires_brands: null, requires_locations: null });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('roles', function (table) {
    table.dropColumn('requires_brands');
    table.dropColumn('requires_locations');
  });
};

