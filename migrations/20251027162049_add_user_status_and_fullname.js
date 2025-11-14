// migrations/20251027162049_add_user_status_and_fullname.js (KLASSIK PROMISE USULIDA QAYTA YOZILGAN)

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    // `up` funksiyasi migratsiyani qo'llaydi
    return knex.schema.table('users', function(table) {
      // 1. Yangi ustunlarni qo'shamiz
      table.string('fullname');
      table.string('status').notNullable().defaultTo('active');
    })
    .then(function() {
      // 2. Mavjud ma'lumotlarni yangi `status` ustuniga o'tkazamiz
      return Promise.all([
        knex('users').where('is_active', true).update({ status: 'active' }),
        knex('users').where('is_active', false).update({ status: 'blocked' })
      ]);
    })
    .then(function() {
      // 3. Eski `is_active` ustunini o'chiramiz
      return knex.schema.table('users', function(table) {
        table.dropColumn('is_active');
      });
    });
  };
  
  /**
   * @param { import("knex").Knex } knex
   * @returns { Promise<void> }
   */
  exports.down = function(knex) {
    // `down` funksiyasi migratsiyani bekor qiladi (rollback)
    return knex.schema.table('users', function(table) {
      // 1. O'chirilgan `is_active` ustunini qayta qo'shamiz
      table.boolean('is_active').notNullable().defaultTo(true);
    })
    .then(function() {
      // 2. `status` ustunidagi ma'lumotlarni `is_active`ga qaytaramiz
      return Promise.all([
          knex('users').where('status', 'active').update({ is_active: true }),
          knex('users').whereNot('status', 'active').update({ is_active: false })
      ]);
    })
    .then(function() {
      // 3. Yangi qo'shilgan ustunlarni o'chirib tashlaymiz
      return knex.schema.table('users', function(table) {
        table.dropColumn('fullname');
        table.dropColumn('status');
      });
    });
  };
  