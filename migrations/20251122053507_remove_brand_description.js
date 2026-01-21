/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // PostgreSQL'da ALTER TABLE DROP COLUMN qo'llab-quvvatlanadi
  // Avval jadval mavjudligini tekshiramiz
  const hasBrands = await knex.schema.hasTable('brands');
  if (!hasBrands) {
    return; // Jadval mavjud emas, migration kerak emas
  }
  
  // description ustunini tekshiramiz
  const hasDescriptionColumn = await knex.schema.hasColumn('brands', 'description');
  if (!hasDescriptionColumn) {
    return; // Ustun mavjud emas, migration kerak emas
  }
  
  // PostgreSQL'da to'g'ridan-to'g'ri ustunni o'chirish
  await knex.schema.table('brands', function(table) {
    table.dropColumn('description');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('brands', function(table) {
    table.string('description');
  });
};
