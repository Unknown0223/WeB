/**
 * Fix debt_reminders unique constraint
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const client = knex.client.config.client;
  const isPostgres = client === 'pg';
  const hasDebtRemindersTable = await knex.schema.hasTable('debt_reminders');
  
  if (!hasDebtRemindersTable) {
    return; // Jadval mavjud emas
  }
  
  try {
    // Index mavjudligini tekshirish
    let indexExists = false;
    
    if (isPostgres) {
      // PostgreSQL uchun
      const result = await knex.raw(`
        SELECT 1 FROM pg_indexes 
        WHERE tablename = $1 AND indexname = $2
      `, ['debt_reminders', 'debt_reminders_request_id_unique']);
      indexExists = result.rows && result.rows.length > 0;
    } else {
      // SQLite uchun
      const result = await knex.raw(`
    SELECT COUNT(*) as count 
    FROM sqlite_master 
    WHERE type='index' 
    AND name='debt_reminders_request_id_unique'
  `);
      const count = Array.isArray(result) ? result[0]?.count : result[0]?.count;
      indexExists = parseInt(count) > 0;
    }
    
    // Agar index mavjud bo'lsa, o'chirish
    if (indexExists) {
      await knex.schema.table('debt_reminders', function(table) {
        table.dropUnique('request_id', 'debt_reminders_request_id_unique');
      });
    }
    
    // Yangi unique constraint qo'shish (composite: request_id + reminder_type)
    // Avval mavjud bo'lsa, o'chirish
    try {
      await knex.schema.table('debt_reminders', function(table) {
        table.unique(['request_id', 'reminder_type'], 'debt_reminders_request_type_unique');
      });
    } catch (err) {
      // Constraint allaqachon mavjud bo'lishi mumkin
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
    }
  } catch (err) {
    console.warn('debt_reminders unique constraint yangilashda xato:', err.message);
    // Xatoni e'tiborsiz qoldirish - constraint allaqachon to'g'ri bo'lishi mumkin
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasDebtRemindersTable = await knex.schema.hasTable('debt_reminders');
  
  if (!hasDebtRemindersTable) {
    return;
  }
  
  try {
    // Yangi constraint'ni o'chirish
    await knex.schema.table('debt_reminders', function(table) {
      table.dropUnique(['request_id', 'reminder_type'], 'debt_reminders_request_type_unique');
    });
    
    // Eski constraint'ni qaytarish
    await knex.schema.table('debt_reminders', function(table) {
      table.unique('request_id', 'debt_reminders_request_id_unique');
    });
  } catch (err) {
    console.warn('debt_reminders unique constraint rollback da xato:', err.message);
  }
};
