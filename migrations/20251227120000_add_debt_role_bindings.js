/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Debt-approval Role Brands (Rol-Brend bog'lanishi)
    .createTable('debt_role_brands', table => {
      table.increments('id').primary();
      table.string('role_name').references('role_name').inTable('roles').onDelete('CASCADE');
      table.integer('debt_brand_id').references('id').inTable('debt_brands').onDelete('CASCADE');
      table.unique(['role_name', 'debt_brand_id']);
      table.timestamps(true, true);
    })
    
    // Debt-approval Role Branches (Rol-Filial bog'lanishi)
    .createTable('debt_role_branches', table => {
      table.increments('id').primary();
      table.string('role_name').references('role_name').inTable('roles').onDelete('CASCADE');
      table.integer('debt_branch_id').references('id').inTable('debt_branches').onDelete('CASCADE');
      table.unique(['role_name', 'debt_branch_id']);
      table.timestamps(true, true);
    })
    
    // Debt-approval Role SVRs (Rol-SVR bog'lanishi) - ixtiyoriy
    .createTable('debt_role_svrs', table => {
      table.increments('id').primary();
      table.string('role_name').references('role_name').inTable('roles').onDelete('CASCADE');
      table.integer('debt_svr_id').references('id').inTable('debt_svrs').onDelete('CASCADE');
      table.unique(['role_name', 'debt_svr_id']);
      table.timestamps(true, true);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('debt_role_svrs')
    .dropTableIfExists('debt_role_branches')
    .dropTableIfExists('debt_role_brands');
};

