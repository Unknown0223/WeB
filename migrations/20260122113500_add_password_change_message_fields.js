/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // `users` jadvalida `password_change_message_id` ustuni mavjudligini tekshiramiz
    const hasPasswordChangeMessageIdColumn = await knex.schema.hasColumn('users', 'password_change_message_id');
    if (!hasPasswordChangeMessageIdColumn) {
        // Agar mavjud bo'lmasa, qo'shamiz
        await knex.schema.table('users', function(table) {
            table.bigInteger('password_change_message_id');
        });
    }
    
    // `users` jadvalida `must_delete_password_change_message` ustuni mavjudligini tekshiramiz
    const hasMustDeletePasswordChangeMessageColumn = await knex.schema.hasColumn('users', 'must_delete_password_change_message');
    if (!hasMustDeletePasswordChangeMessageColumn) {
        // Agar mavjud bo'lmasa, qo'shamiz
        await knex.schema.table('users', function(table) {
            table.boolean('must_delete_password_change_message').defaultTo(false);
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // O'zgarishlarni teskari tartibda bekor qilish
    const hasPasswordChangeMessageIdColumn = await knex.schema.hasColumn('users', 'password_change_message_id');
    if (hasPasswordChangeMessageIdColumn) {
        await knex.schema.table('users', function(table) {
            table.dropColumn('password_change_message_id');
        });
    }
    
    const hasMustDeletePasswordChangeMessageColumn = await knex.schema.hasColumn('users', 'must_delete_password_change_message');
    if (hasMustDeletePasswordChangeMessageColumn) {
        await knex.schema.table('users', function(table) {
            table.dropColumn('must_delete_password_change_message');
        });
    }
};

