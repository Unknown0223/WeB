/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Debt-approval Brands (alohida, chunki hozirgi brands jadvali boshqa maqsadda)
    .createTable('debt_brands', table => {
      table.increments('id').primary();
      table.string('name').unique().notNullable();
      table.timestamps(true, true);
    })
    
    // Debt-approval Branches (Filiallar)
    .createTable('debt_branches', table => {
      table.increments('id').primary();
      table.integer('brand_id').references('id').inTable('debt_brands').onDelete('CASCADE');
      table.string('name').notNullable();
      table.unique(['brand_id', 'name']);
      table.timestamps(true, true);
    })
    
    // Debt-approval SVR (FISH)
    .createTable('debt_svrs', table => {
      table.increments('id').primary();
      table.integer('brand_id').references('id').inTable('debt_brands').onDelete('CASCADE');
      table.integer('branch_id').references('id').inTable('debt_branches').onDelete('CASCADE');
      table.string('name').notNullable();
      table.timestamps(true, true);
    })
    
    // Debt-approval Requests (So'rovlar)
    .createTable('debt_requests', table => {
      table.increments('id').primary();
      table.string('request_uid').unique().notNullable();
      table.string('type').notNullable(); // SET, NORMAL
      table.integer('brand_id').references('id').inTable('debt_brands');
      table.integer('branch_id').references('id').inTable('debt_branches');
      table.integer('svr_id').references('id').inTable('debt_svrs');
      table.string('status').notNullable();
      table.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
      table.boolean('locked').defaultTo(false);
      table.text('extra_info').nullable();
      table.timestamps(true, true);
    })
    
    // Debt-approval Request Logs (Audit)
    .createTable('debt_request_logs', table => {
      table.increments('id').primary();
      table.integer('request_id').references('id').inTable('debt_requests').onDelete('CASCADE');
      table.string('action').notNullable();
      table.string('old_status').nullable();
      table.string('new_status').nullable();
      table.integer('performed_by').references('id').inTable('users').onDelete('SET NULL');
      table.text('note').nullable();
      table.timestamps(true, true);
    })
    
    // Debt-approval User Brands (Foydalanuvchi-Brend bog'lanishi)
    .createTable('debt_user_brands', table => {
      table.increments('id').primary();
      table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.integer('brand_id').references('id').inTable('debt_brands').onDelete('CASCADE');
      table.unique(['user_id', 'brand_id']);
    })
    
    // Debt-approval User Branches (Foydalanuvchi-Filial bog'lanishi)
    .createTable('debt_user_branches', table => {
      table.increments('id').primary();
      table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.integer('branch_id').references('id').inTable('debt_branches').onDelete('CASCADE');
      table.unique(['user_id', 'branch_id']);
    })
    
    // Debt-approval Attachments (Fayllar)
    .createTable('debt_attachments', table => {
      table.increments('id').primary();
      table.integer('request_id').references('id').inTable('debt_requests').onDelete('CASCADE');
      table.string('file_type').notNullable(); // excel, image
      table.string('file_id').nullable(); // Telegram file_id
      table.string('file_path').nullable(); // Server path
      table.integer('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
    })
    
    // Debt-approval Debt Reports (Qarzdorlik hisobotlari)
    .createTable('debt_reports', table => {
      table.increments('id').primary();
      table.integer('request_id').references('id').inTable('debt_requests').onDelete('CASCADE');
      table.integer('client_id').nullable();
      table.string('client_name').nullable();
      table.decimal('debt_amount', 15, 2).notNullable();
      table.text('comment').nullable();
      table.integer('reported_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('debt_reports')
    .dropTableIfExists('debt_attachments')
    .dropTableIfExists('debt_user_branches')
    .dropTableIfExists('debt_user_brands')
    .dropTableIfExists('debt_request_logs')
    .dropTableIfExists('debt_requests')
    .dropTableIfExists('debt_svrs')
    .dropTableIfExists('debt_branches')
    .dropTableIfExists('debt_brands');
};
