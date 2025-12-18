/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // old_location ustunini olib tashlash
    await knex.schema.table('report_history', table => {
        table.dropColumn('old_location');
    });
    
    // old_brand_id ustunini qo'shish
    await knex.schema.table('report_history', table => {
        table.integer('old_brand_id').unsigned().nullable();
        table.foreign('old_brand_id').references('brands.id').onDelete('SET NULL');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.table('report_history', table => {
        table.dropForeign('old_brand_id');
        table.dropColumn('old_brand_id');
    });
    
    await knex.schema.table('report_history', table => {
        table.string('old_location', 255).nullable();
    });
};
