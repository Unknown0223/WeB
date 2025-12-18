/**
 * Create Comparisons Table Migration
 * Solishtirish ma'lumotlarini saqlash uchun jadval
 * 
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('comparisons', function(table) {
    table.increments('id').primary();
    table.date('comparison_date').notNullable();
    table.integer('brand_id').unsigned().notNullable().references('id').inTable('brands').onDelete('CASCADE');
    table.string('location', 255).notNullable();
    table.decimal('operator_amount', 15, 2).notNullable().defaultTo(0);
    table.decimal('comparison_amount', 15, 2).nullable();
    table.decimal('difference', 15, 2).nullable();
    table.decimal('percentage', 5, 2).nullable();
    table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Unique constraint: bir sana, brend va filial uchun faqat bitta yozuv
    table.unique(['comparison_date', 'brand_id', 'location'], 'unique_comparison');
    
    // Indexes for better performance
    table.index('comparison_date', 'idx_comparisons_date');
    table.index('brand_id', 'idx_comparisons_brand');
    table.index('location', 'idx_comparisons_location');
    table.index(['comparison_date', 'brand_id'], 'idx_comparisons_date_brand');
  });
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('comparisons');
};

