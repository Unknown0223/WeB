
exports.up = function(knex) {
  return knex.schema.createTable('feedbacks', table => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().nullable();
    table.string('username').nullable();
    table.string('fullname').nullable();
    table.string('type').notNullable(); // 'taklif' yoki 'shikoyat'
    table.text('message').notNullable();
    table.string('status').defaultTo('new'); // 'new', 'read', 'archived'
    table.bigInteger('telegram_chat_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('feedbacks');
};
