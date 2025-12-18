exports.up = function(knex) {
    return knex.schema.createTable('exchange_rates', (table) => {
        table.increments('id').primary();
        table.string('base_currency', 10).notNullable().defaultTo('UZS');
        table.string('target_currency', 10).notNullable(); // USD, EUR, RUB
        table.decimal('rate', 15, 4).notNullable(); // 1 target_currency = rate UZS
        table.date('date').notNullable(); // Kurs sanasi
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        
        // Bir kunda bir xil valyuta uchun faqat bitta kurs bo'lishi kerak
        table.unique(['base_currency', 'target_currency', 'date']);
        table.index(['date', 'target_currency']);
    });
};

exports.down = function(knex) {
    return knex.schema.dropTableIfExists('exchange_rates');
};

