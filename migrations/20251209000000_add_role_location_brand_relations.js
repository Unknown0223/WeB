// migrations/20251209000000_add_role_location_brand_relations.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Jadval mavjudligini tekshirish
  const hasRoleLocations = await knex.schema.hasTable('role_locations');
  const hasRoleBrands = await knex.schema.hasTable('role_brands');
  
  // Rol-Filial bog'lanish jadvali (by_location uchun)
  if (!hasRoleLocations) {
    try {
      await knex.schema.createTable('role_locations', function(table) {
        table.increments('id').primary();
        table.string('role_name').notNullable().references('role_name').inTable('roles').onDelete('CASCADE');
        table.string('location_name').notNullable();
        table.unique(['role_name', 'location_name']);
      });
    } catch (error) {
      // Agar jadval allaqachon mavjud bo'lsa, xatoni e'tiborsiz qoldirish
      const errorMsg = (error.message || error.toString()).toLowerCase();
      if (errorMsg.includes('already exists') || errorMsg.includes('sqlite_error')) {
        // Jadval mavjudligini qayta tekshirish
        const tableExists = await knex.schema.hasTable('role_locations');
        if (!tableExists) {
          // Agar jadval hali ham mavjud emas bo'lsa, xatoni tashlash
          throw error;
        }
        // Jadval mavjud, xatoni e'tiborsiz qoldirish
        return;
      }
      // Boshqa xatolar bo'lsa, ularni tashlash
      throw error;
    }
  }
  
  // Rol-Brend bog'lanish jadvali (by_brand uchun)
  if (!hasRoleBrands) {
    try {
      await knex.schema.createTable('role_brands', function(table) {
        table.increments('id').primary();
        table.string('role_name').notNullable().references('role_name').inTable('roles').onDelete('CASCADE');
        table.integer('brand_id').notNullable().references('id').inTable('brands').onDelete('CASCADE');
        table.unique(['role_name', 'brand_id']);
      });
    } catch (error) {
      // Agar jadval allaqachon mavjud bo'lsa, xatoni e'tiborsiz qoldirish
      const errorMsg = (error.message || error.toString()).toLowerCase();
      if (errorMsg.includes('already exists') || errorMsg.includes('sqlite_error')) {
        // Jadval mavjudligini qayta tekshirish
        const tableExists = await knex.schema.hasTable('role_brands');
        if (!tableExists) {
          // Agar jadval hali ham mavjud emas bo'lsa, xatoni tashlash
          throw error;
        }
        // Jadval mavjud, xatoni e'tiborsiz qoldirish
        return;
      }
      // Boshqa xatolar bo'lsa, ularni tashlash
      throw error;
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('role_brands')
    .dropTableIfExists('role_locations');
};
