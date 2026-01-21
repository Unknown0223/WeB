/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('debt_blocked_items', function(table) {
    table.increments('id').primary();
    table.string('item_type').notNullable(); // 'brand', 'branch', 'svr'
    table.integer('brand_id').nullable().references('id').inTable('debt_brands').onDelete('CASCADE');
    table.integer('branch_id').nullable().references('id').inTable('debt_branches').onDelete('CASCADE');
    table.integer('svr_id').nullable().references('id').inTable('debt_svrs').onDelete('CASCADE');
    table.text('reason').nullable(); // Bloklash sababi
    table.text('comment').nullable(); // Qo'shimcha izoh
    table.integer('blocked_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('blocked_at').defaultTo(knex.fn.now());
    table.timestamp('unblocked_at').nullable();
    table.integer('unblocked_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.boolean('is_active').defaultTo(true);
    
    // Indexes
    table.index(['item_type', 'is_active']);
    table.index(['brand_id', 'is_active']);
    table.index(['branch_id', 'is_active']);
    table.index(['svr_id', 'is_active']);
    
    // Unique constraint: faqat bitta faol bloklash bo'lishi kerak
    // Lekin bu murakkab, shuning uchun application level'da tekshiramiz
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('debt_blocked_items');
};

