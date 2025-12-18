/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Idempotent migration - jadval mavjudligini tekshirish
    const hasTable = await knex.schema.hasTable('user_permissions');
    
    if (!hasTable) {
        await knex.schema.createTable('user_permissions', table => {
            table.increments('id').primary();
            table.integer('user_id').unsigned().notNullable();
            table.string('permission_key', 100).notNullable();
            table.enum('type', ['additional', 'restricted']).notNullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());
            
            // Foreign keys
            table.foreign('user_id').references('users.id').onDelete('CASCADE');
            table.foreign('permission_key').references('permissions.permission_key').onDelete('CASCADE');
            
            // Unique constraint - bir user uchun bitta permission faqat bir marta
            table.unique(['user_id', 'permission_key', 'type']);
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.dropTableIfExists('user_permissions');
};
