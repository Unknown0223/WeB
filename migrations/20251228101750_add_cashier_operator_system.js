/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. debt_cashiers - Kassirlar va filiallar biriktirish
  await knex.schema.createTable('debt_cashiers', table => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    table.integer('branch_id').references('id').inTable('debt_branches').onDelete('CASCADE').notNullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('assigned_at').defaultTo(knex.fn.now());
    table.unique(['user_id', 'branch_id']);
    table.timestamps(true, true);
  });

  // 2. debt_operators - Operatorlar va brendlar biriktirish
  await knex.schema.createTable('debt_operators', table => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    table.integer('brand_id').references('id').inTable('debt_brands').onDelete('CASCADE').notNullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('assigned_at').defaultTo(knex.fn.now());
    table.unique(['user_id', 'brand_id']);
    table.timestamps(true, true);
  });

  // 3. debt_groups - Telegram guruhlari
  await knex.schema.createTable('debt_groups', table => {
    table.increments('id').primary();
    table.string('group_type', 20).notNullable(); // 'leaders', 'operators', 'final'
    table.bigInteger('telegram_group_id').unique().notNullable();
    table.string('name').notNullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  // 4. debt_request_approvals - Tasdiqlashlar tarixi
  await knex.schema.createTable('debt_request_approvals', table => {
    table.increments('id').primary();
    table.integer('request_id').references('id').inTable('debt_requests').onDelete('CASCADE').notNullable();
    table.integer('approver_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('approval_type', 20).notNullable(); // 'leader', 'cashier', 'operator'
    table.string('status', 20).notNullable(); // 'approved', 'rejected', 'debt_marked'
    table.text('note').nullable();
    table.string('excel_file_path').nullable();
    table.string('image_file_path').nullable();
    table.decimal('debt_amount', 15, 2).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 5. debt_data_history - Ma'lumotlar o'zgarish tarixi
  await knex.schema.createTable('debt_data_history', table => {
    table.increments('id').primary();
    table.string('entity_type', 20).notNullable(); // 'brand', 'branch', 'svr'
    table.integer('entity_id').notNullable();
    table.string('old_name').notNullable();
    table.string('new_name').notNullable();
    table.integer('changed_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('changed_at').defaultTo(knex.fn.now());
    table.text('change_reason').nullable();
  });

  // 6. debt_settings - Tizim sozlamalari
  await knex.schema.createTable('debt_settings', table => {
    table.increments('id').primary();
    table.string('key').unique().notNullable();
    table.text('value').notNullable();
    table.text('description').nullable();
    table.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // 7. debt_reminders - Eslatmalar
  await knex.schema.createTable('debt_reminders', table => {
    table.increments('id').primary();
    table.integer('request_id').references('id').inTable('debt_requests').onDelete('CASCADE').notNullable();
    table.integer('reminder_count').defaultTo(0);
    table.timestamp('last_reminder_at').nullable();
    table.timestamp('next_reminder_at').nullable();
    table.integer('max_reminders').defaultTo(3);
    table.timestamps(true, true);
  });

  // 8. debt_requests jadvaliga qo'shimchalar
  const hasCurrentApproverId = await knex.schema.hasColumn('debt_requests', 'current_approver_id');
  if (!hasCurrentApproverId) {
    await knex.schema.alterTable('debt_requests', table => {
      table.integer('current_approver_id').references('id').inTable('users').onDelete('SET NULL');
      table.string('current_approver_type', 20).nullable(); // 'leader', 'cashier', 'operator'
      table.bigInteger('preview_message_id').nullable();
      table.bigInteger('final_message_id').nullable();
      table.integer('locked_by').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('locked_at').nullable();
    });
  }

  // 9. debt_brands, debt_branches, debt_svrs jadvallariga qo'shimchalar
  const brandHasStatus = await knex.schema.hasColumn('debt_brands', 'status');
  if (!brandHasStatus) {
    await knex.schema.alterTable('debt_brands', table => {
      table.string('status', 20).defaultTo('active'); // 'active', 'archived'
      table.timestamp('changed_at').nullable();
      table.integer('changed_by').references('id').inTable('users').onDelete('SET NULL');
    });
  }

  const branchHasStatus = await knex.schema.hasColumn('debt_branches', 'status');
  if (!branchHasStatus) {
    await knex.schema.alterTable('debt_branches', table => {
      table.string('status', 20).defaultTo('active');
      table.timestamp('changed_at').nullable();
      table.integer('changed_by').references('id').inTable('users').onDelete('SET NULL');
    });
  }

  const svrHasStatus = await knex.schema.hasColumn('debt_svrs', 'status');
  if (!svrHasStatus) {
    await knex.schema.alterTable('debt_svrs', table => {
      table.string('status', 20).defaultTo('active');
      table.timestamp('changed_at').nullable();
      table.integer('changed_by').references('id').inTable('users').onDelete('SET NULL');
    });
  }

  // 10. Boshlang'ich sozlamalar
  await knex('debt_settings').insert([
    {
      key: 'max_file_size_mb',
      value: '20',
      description: 'Maksimal fayl hajmi (MB)'
    },
    {
      key: 'debt_reminder_interval',
      value: '30',
      description: 'Eslatma intervali (daqiqa)'
    },
    {
      key: 'debt_reminder_max_count',
      value: '3',
      description: 'Eslatma maksimal soni'
    },
    {
      key: 'excel_column_brand',
      value: 'Brend',
      description: 'Excel faylda Brend ustuni nomi'
    },
    {
      key: 'excel_column_branch',
      value: 'Filial',
      description: 'Excel faylda Filial ustuni nomi'
    },
    {
      key: 'excel_column_svr',
      value: 'SVR FISH',
      description: 'Excel faylda SVR FISH ustuni nomi'
    }
  ]).onConflict('key').ignore();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('debt_reminders');
  await knex.schema.dropTableIfExists('debt_settings');
  await knex.schema.dropTableIfExists('debt_data_history');
  await knex.schema.dropTableIfExists('debt_request_approvals');
  await knex.schema.dropTableIfExists('debt_groups');
  await knex.schema.dropTableIfExists('debt_operators');
  await knex.schema.dropTableIfExists('debt_cashiers');

  // Qo'shimchalarni olib tashlash
  const hasCurrentApproverId = await knex.schema.hasColumn('debt_requests', 'current_approver_id');
  if (hasCurrentApproverId) {
    await knex.schema.alterTable('debt_requests', table => {
      table.dropColumn('current_approver_id');
      table.dropColumn('current_approver_type');
      table.dropColumn('preview_message_id');
      table.dropColumn('final_message_id');
      table.dropColumn('locked_by');
      table.dropColumn('locked_at');
    });
  }

  const brandHasStatus = await knex.schema.hasColumn('debt_brands', 'status');
  if (brandHasStatus) {
    await knex.schema.alterTable('debt_brands', table => {
      table.dropColumn('status');
      table.dropColumn('changed_at');
      table.dropColumn('changed_by');
    });
  }

  const branchHasStatus = await knex.schema.hasColumn('debt_branches', 'status');
  if (branchHasStatus) {
    await knex.schema.alterTable('debt_branches', table => {
      table.dropColumn('status');
      table.dropColumn('changed_at');
      table.dropColumn('changed_by');
    });
  }

  const svrHasStatus = await knex.schema.hasColumn('debt_svrs', 'status');
  if (svrHasStatus) {
    await knex.schema.alterTable('debt_svrs', table => {
      table.dropColumn('status');
      table.dropColumn('changed_at');
      table.dropColumn('changed_by');
    });
  }
};
