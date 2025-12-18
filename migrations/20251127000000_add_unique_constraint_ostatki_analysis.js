/**
 * @param { import('knex').Knex } knex
 */
exports.up = async function(knex) {
  // Avval mavjud duplicate'larni tozalash
  try {
    const duplicatesResult = await knex.raw(`
      SELECT smart_code, filial, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM ostatki_analysis
      GROUP BY smart_code, filial
      HAVING COUNT(*) > 1
    `);
    
    // SQLite uchun natijani to'g'ri olish
    let dupRows = [];
    if (duplicatesResult && duplicatesResult.length > 0) {
      dupRows = Array.isArray(duplicatesResult) ? duplicatesResult : (duplicatesResult[0] || []);
    } else if (duplicatesResult && !Array.isArray(duplicatesResult)) {
      // SQLite natijasi object ko'rinishida bo'lishi mumkin
      dupRows = duplicatesResult.rows || [];
    }
    
    if (dupRows && dupRows.length > 0) {
      console.log(`Topilgan duplicate guruhlar: ${dupRows.length} ta`);
      
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
              console.log(`  ✓ ${dup.smart_code || 'N/A'} - ${dup.filial || 'N/A'}: ${deleteIds.length} ta duplicate o'chirildi`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Duplicate tozalashda xatolik (ehtimol jadval bo\'sh):', err.message);
    // Xatolik bo'lsa ham davom etish
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

