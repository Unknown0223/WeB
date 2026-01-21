/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // request_id ga UNIQUE constraint qo'shish
  // SQLite uchun alohida yondashuv kerak
  const hasUnique = await knex.raw(`
    SELECT COUNT(*) as count 
    FROM sqlite_master 
    WHERE type='index' 
    AND name='debt_reminders_request_id_unique'
  `);
  
  const count = hasUnique[0]?.count || 0;
  
  if (count === 0) {
    await knex.raw(`
      CREATE UNIQUE INDEX debt_reminders_request_id_unique 
      ON debt_reminders(request_id)
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS debt_reminders_request_id_unique
  `);
};
