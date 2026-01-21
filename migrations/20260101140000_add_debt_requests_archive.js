/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Debt-approval Requests Archive (Arxivlangan so'rovlar)
    .createTable('debt_requests_archive', table => {
      table.increments('id').primary();
      table.integer('original_request_id').nullable(); // Asl so'rov ID (agar mavjud bo'lsa)
      table.string('request_uid').notNullable();
      table.string('type').notNullable(); // SET, NORMAL
      table.integer('brand_id').nullable();
      table.string('brand_name').nullable(); // Arxivlash vaqtida brend nomi
      table.integer('branch_id').nullable();
      table.string('branch_name').nullable(); // Arxivlash vaqtida filial nomi
      table.integer('svr_id').nullable();
      table.string('svr_name').nullable(); // Arxivlash vaqtida SVR nomi
      table.string('status').notNullable();
      table.integer('created_by').nullable();
      table.string('created_by_username').nullable(); // Arxivlash vaqtida foydalanuvchi nomi
      table.boolean('locked').defaultTo(false);
      table.integer('locked_by').nullable();
      table.timestamp('locked_at').nullable();
      table.integer('current_approver_id').nullable();
      table.string('current_approver_type').nullable();
      table.text('extra_info').nullable();
      table.text('excel_data').nullable(); // JSON string
      table.text('excel_headers').nullable(); // JSON string
      table.text('excel_columns').nullable(); // JSON string
      table.decimal('excel_total', 15, 2).nullable();
      table.integer('preview_message_id').nullable();
      table.integer('preview_chat_id').nullable();
      table.timestamp('archived_at').defaultTo(knex.fn.now()); // Arxivlash vaqti
      table.integer('archived_by').references('id').inTable('users').onDelete('SET NULL'); // Kim arxivlagan
      table.string('archive_reason').nullable(); // Arxivlash sababi (oy, yil, manual, etc.)
      table.timestamps(true, true);
      
      // Indexes
      table.index('original_request_id');
      table.index('request_uid');
      table.index('archived_at');
      table.index('archived_by');
      table.index(['brand_id', 'archived_at']);
      table.index(['branch_id', 'archived_at']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('debt_requests_archive');
};

