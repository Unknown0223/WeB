exports.up = function (knex) {
    return knex.schema.createTable('special_requests_messages', function (t) {
        t.integer('group_message_id').primary();
        t.bigInteger('user_id').notNullable();
        t.text('caption').notNullable();
        t.timestamps(true, true);
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('special_requests_messages');
};
