/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // SQLite da ALTER TABLE DROP COLUMN yo'q, shuning uchun jadval qayta yaratamiz
  const brands = await knex('brands').select('*');
  
  await knex.schema.dropTable('brands');
  
  await knex.schema.createTable('brands', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.integer('created_by').references('id').inTable('users');
    table.datetime('created_at').defaultTo(knex.fn.now());
    table.datetime('updated_at');
  });
  
  // Ma'lumotlarni qaytarish (description siz)
  if (brands.length > 0) {
    await knex('brands').insert(brands.map(b => ({
      id: b.id,
      name: b.name,
      created_by: b.created_by,
      created_at: b.created_at,
      updated_at: b.updated_at
    })));
  }
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
