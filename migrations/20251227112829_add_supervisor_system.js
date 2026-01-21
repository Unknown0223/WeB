/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Debt-approval User SVRs (Foydalanuvchi-SVR bog'lanishi)
    .createTable('debt_user_svrs', table => {
      table.increments('id').primary();
      table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.integer('svr_id').references('id').inTable('debt_svrs').onDelete('CASCADE');
      table.unique(['user_id', 'svr_id']);
      table.timestamps(true, true);
    })
    
    // Debt-approval User Tasks (Foydalanuvchi vazifalari)
    .createTable('debt_user_tasks', table => {
      table.increments('id').primary();
      table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.string('task_type').notNullable(); // 'create', 'approve_leader', 'approve_cashier', 'approve_supervisor', 'approve_operator', 'mark_debt'
      table.integer('brand_id').nullable().references('id').inTable('debt_brands').onDelete('CASCADE');
      table.integer('branch_id').nullable().references('id').inTable('debt_branches').onDelete('CASCADE');
      table.integer('svr_id').nullable().references('id').inTable('debt_svrs').onDelete('CASCADE');
      table.timestamps(true, true);
      // Bir xil vazifa bir necha marta qo'shilmasligi uchun unique constraint
      table.unique(['user_id', 'task_type', 'brand_id', 'branch_id', 'svr_id'], 'unique_user_task');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('debt_user_tasks')
    .dropTableIfExists('debt_user_svrs');
};

