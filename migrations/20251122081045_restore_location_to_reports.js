/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // old_brand_id ustunini olib tashlash
    await knex.schema.table('report_history', table => {
        table.dropForeign('old_brand_id');
        table.dropColumn('old_brand_id');
    });
    
    // old_location ustunini qaytarish
    await knex.schema.table('report_history', table => {
        table.string('old_location', 255).nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.table('report_history', table => {
        table.dropColumn('old_location');
    });
    
    await knex.schema.table('report_history', table => {
        table.integer('old_brand_id').unsigned().nullable();
        table.foreign('old_brand_id').references('brands.id').onDelete('SET NULL');
    });
};
