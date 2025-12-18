/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'bot_login_message_id');
    if (!hasColumn) {
        await knex.schema.table('users', function(table) {
            table.bigInteger('bot_login_message_id').nullable();
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'bot_login_message_id');
    if (hasColumn) {
        await knex.schema.table('users', function(table) {
            table.dropColumn('bot_login_message_id');
        });
    }
};

