/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('debt_requests', table => {
    table.string('telegraph_url', 500).nullable().comment('Telegraph sahifa URL (qayta ishlatish uchun)');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('debt_requests', table => {
    table.dropColumn('telegraph_url');
  });
};

