/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // old_brand_id ustunini qo'shish (agar mavjud bo'lmasa)
    const hasColumn = await knex.schema.hasColumn('report_history', 'old_brand_id');
    
    if (!hasColumn) {
        await knex.schema.table('report_history', table => {
            table.integer('old_brand_id').nullable();
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    const hasColumn = await knex.schema.hasColumn('report_history', 'old_brand_id');
    
    if (hasColumn) {
        await knex.schema.table('report_history', table => {
            try {
                table.dropForeign('old_brand_id');
            } catch (error) {
                // Foreign key bo'lmasa, o'tkazib yuboramiz
            }
            table.dropColumn('old_brand_id');
        });
    }
};
