/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Проверяем, существует ли столбец old_location
    const hasColumn = await knex.schema.hasColumn('report_history', 'old_location');
    
    if (!hasColumn) {
        // Если столбец не существует, добавляем его
        await knex.schema.table('report_history', table => {
            table.string('old_location', 255).nullable();
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.table('report_history', table => {
        table.dropColumn('old_location');
    });
};
