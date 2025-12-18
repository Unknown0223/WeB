exports.up = function(knex) {
    return knex.schema.table('users', (table) => {
        table.string('preferred_currency', 10).nullable();
    });
};

exports.down = function(knex) {
    return knex.schema.table('users', (table) => {
        table.dropColumn('preferred_currency');
    });
};

