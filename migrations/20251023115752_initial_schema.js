// migrations/YYYYMMDDHHMMSS_initial_schema.js

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  // Bu funksiya migratsiyani qo'llaydi
  return knex.schema
    .createTable('roles', function (table) {
      table.string('role_name').primary().notNullable();
    })
    .createTable('permissions', function (table) {
      table.string('permission_key').primary().notNullable();
      table.string('description').notNullable();
      table.string('category').notNullable();
    })
    .createTable('role_permissions', function (table) {
      table.string('role_name').references('role_name').inTable('roles').onDelete('CASCADE');
      table.string('permission_key').references('permission_key').inTable('permissions').onDelete('CASCADE');
      table.primary(['role_name', 'permission_key']);
    })
    .createTable('users', function (table) {
      table.increments('id').primary();
      table.string('username').unique().notNullable();
      table.string('password').notNullable();
      table.string('secret_word');
      table.string('role').notNullable().defaultTo('operator');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('device_limit').notNullable().defaultTo(1);
      table.integer('telegram_chat_id').unique();
      table.string('telegram_username');
      table.integer('login_attempts').notNullable().defaultTo(0);
      table.datetime('last_attempt_at');
      table.string('lock_reason');
    })
    .createTable('user_locations', function (table) {
      table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.string('location_name');
      table.primary(['user_id', 'location_name']);
    })
    .createTable('reports', function (table) {
      table.increments('id').primary();
      table.string('report_date').notNullable();
      table.string('location').notNullable();
      table.text('data').notNullable();
      table.text('settings').notNullable();
      table.integer('created_by').references('id').inTable('users');
      table.datetime('created_at').defaultTo(knex.fn.now());
      table.integer('updated_by').references('id').inTable('users');
      table.datetime('updated_at');
      table.text('late_comment');
    })
    .createTable('report_history', function (table) {
      table.increments('id').primary();
      table.integer('report_id').notNullable().references('id').inTable('reports').onDelete('CASCADE');
      table.text('old_data').notNullable();
      table.integer('changed_by').notNullable().references('id').inTable('users');
      table.datetime('changed_at').defaultTo(knex.fn.now());
    })
    .createTable('settings', function (table) {
      table.string('key').primary();
      table.text('value');
    })
    .createTable('pivot_templates', function (table) {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('report').notNullable();
      table.integer('created_by').references('id').inTable('users');
      table.datetime('created_at').defaultTo(knex.fn.now());
    })
    .createTable('magic_links', function (table) {
      table.string('token').primary().notNullable();
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.datetime('expires_at').notNullable();
    })
    .createTable('audit_logs', function (table) {
        table.increments('id').primary();
        table.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
        table.string('action').notNullable();
        table.string('target_type');
        table.integer('target_id');
        table.text('details');
        table.string('ip_address');
        table.string('user_agent'); // Bizning yangi ustunimiz
        table.datetime('timestamp').defaultTo(knex.fn.now());
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Bu funksiya migratsiyani bekor qiladi
  // Jadvallarni teskari tartibda o'chirish kerak (foreign key cheklovlari tufayli)
  return knex.schema
    .dropTableIfExists('audit_logs')
    .dropTableIfExists('magic_links')
    .dropTableIfExists('pivot_templates')
    .dropTableIfExists('settings')
    .dropTableIfExists('report_history')
    .dropTableIfExists('reports')
    .dropTableIfExists('user_locations')
    .dropTableIfExists('users')
    .dropTableIfExists('role_permissions')
    .dropTableIfExists('permissions')
    .dropTableIfExists('roles');
};
