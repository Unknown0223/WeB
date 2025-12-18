exports.up = function(knex) {
    return knex.schema.createTable('password_change_requests', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().notNullable();
        table.text('new_password_hash').notNullable();
        table.string('status').defaultTo('pending'); // pending, approved, rejected
        table.integer('approved_by').unsigned().nullable();
        table.timestamp('requested_at').defaultTo(knex.fn.now());
        table.timestamp('processed_at').nullable();
        table.text('admin_comment').nullable();
        table.string('ip_address').nullable();
        table.text('user_agent').nullable();
        
        table.foreign('user_id').references('users.id').onDelete('CASCADE');
        table.foreign('approved_by').references('users.id').onDelete('SET NULL');
    });
};

exports.down = function(knex) {
    return knex.schema.dropTable('password_change_requests');
};
