exports.up = function(knex) {
    return knex.schema.table('reports', (table) => {
        table.string('currency', 10).nullable();
    });
};

exports.down = function(knex) {
    return knex.schema.table('reports', (table) => {
        table.dropColumn('currency');
    });
};

