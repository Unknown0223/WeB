exports.up = function(knex) {
    return knex.schema.table('users', (table) => {
        table.text('avatar_url').nullable();
    });
};

exports.down = function(knex) {
    return knex.schema.table('users', (table) => {
        table.dropColumn('avatar_url');
    });
};
