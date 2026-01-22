/**
 * @param { import('knex').Knex } knex
 */
exports.up = async function(knex) {
  // Database client turini aniqlash
  const client = knex.client.config.client;
  const isPostgres = client === 'pg';
  
  // Avval mavjud duplicate'larni tozalash
  try {
    // PostgreSQL yoki SQLite ga qarab so'rov
    let duplicatesResult;
    if (isPostgres) {
      // PostgreSQL uchun STRING_AGG ishlatamiz
      duplicatesResult = await knex.raw(`
        SELECT smart_code, filial, COUNT(*) as count, STRING_AGG(id::text, ',') as ids
        FROM ostatki_analysis
        GROUP BY smart_code, filial
        HAVING COUNT(*) > 1
      `);
    } else {
      // SQLite uchun GROUP_CONCAT
      duplicatesResult = await knex.raw(`
        SELECT smart_code, filial, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM ostatki_analysis
        GROUP BY smart_code, filial
        HAVING COUNT(*) > 1
      `);
    }
    
    // Natijani to'g'ri olish
    let dupRows = [];
    if (isPostgres) {
      dupRows = duplicatesResult.rows || [];
    } else {
      if (duplicatesResult && duplicatesResult.length > 0) {
        dupRows = Array.isArray(duplicatesResult) ? duplicatesResult : (duplicatesResult[0] || []);
      } else if (duplicatesResult && !Array.isArray(duplicatesResult)) {
        dupRows = duplicatesResult.rows || [];
      }
    }
    
    if (dupRows && dupRows.length > 0) {
      // Production'da log qilmaymiz (faqat error loglar)
      
      for (const dup of dupRows) {
        const ids = (dup.ids || '').toString().split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id) && id > 0);
        if (ids.length > 1) {
          // Eng yangi versiyani saqlash
          const keepRow = await knex('ostatki_analysis')
            .whereIn('id', ids)
            .orderBy('calculated_at', 'desc')
            .first();
          
          if (keepRow && keepRow.id) {
            const deleteIds = ids.filter(id => id !== keepRow.id);
            if (deleteIds.length > 0) {
              await knex('ostatki_analysis')
                .whereIn('id', deleteIds)
                .delete();
              // Production'da log qilmaymiz
            }
          }
        }
      }
    }
  } catch (err) {
    // Xatolik bo'lsa ham davom etish (migration'da ortiqcha loglar)
  }
  
  // Endi unique constraint qo'shish
  // SQLite'da unique constraint qo'shish uchun index yaratish kerak
  return knex.schema.table('ostatki_analysis', function(table) {
    // Bir xil tovar bir xil filialda faqat bir marta bo'lishi uchun unique constraint
    table.unique(['smart_code', 'filial']);
  });
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = function(knex) {
  return knex.schema.table('ostatki_analysis', function(table) {
    // SQLite'da unique constraint'ni o'chirish
    table.dropUnique(['smart_code', 'filial']);
  });
};

