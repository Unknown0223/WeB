/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // brands jadvaliga sort_order ustunini qo'shish
  const hasColumn = await knex.schema.hasColumn('brands', 'sort_order');
  
  if (!hasColumn) {
    await knex.schema.table('brands', function(table) {
      table.integer('sort_order').nullable().comment('Brend saralash tartibi (1 dan boshlab). Agar null bo\'lsa, alifbo tartibida saralanadi.');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('brands', function(table) {
    table.dropColumn('sort_order');
  });
};

