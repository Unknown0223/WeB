/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('debt_accepted_data', table => {
    table.increments('id').primary();
    table.integer('request_id').references('id').inTable('debt_requests').onDelete('CASCADE').notNullable();
    table.string('request_uid').notNullable();
    table.integer('brand_id').nullable();
    table.integer('branch_id').nullable();
    table.integer('svr_id').nullable();
    table.string('brand_name').nullable();
    table.string('branch_name').nullable();
    table.string('svr_name').nullable();
    table.string('client_id').nullable(); // Excel'dan (ID клиента)
    table.string('client_name').nullable(); // Excel'dan (Клиент)
    table.decimal('debt_amount', 15, 2).nullable(); // Excel'dan (Общий)
    table.text('excel_row_data').nullable(); // Butun qator JSON sifatida (qo'shimcha ma'lumotlar uchun)
    table.timestamp('approved_at').nullable(); // So'rov tasdiqlangan vaqt
    table.integer('approved_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Indexlar
    table.index('request_id');
    table.index('approved_at');
    table.index('brand_id');
    table.index('branch_id');
    table.index('svr_id');
    table.index('client_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('debt_accepted_data');
};

