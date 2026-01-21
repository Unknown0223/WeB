/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // reports jadvalida bir xil sana, filial va brend uchun duplicate'ni oldini olish
  const hasTable = await knex.schema.hasTable('reports');
  
  if (hasTable) {
    // PostgreSQL va SQLite uchun unique constraint qo'shish
    const isPostgres = knex.client.config.client === 'postgresql' || knex.client.config.client === 'pg';
    
    if (isPostgres) {
      // PostgreSQL uchun unique constraint
      try {
        await knex.raw(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_date_location_brand 
          ON reports (report_date, location, COALESCE(brand_id, -1))
          WHERE brand_id IS NOT NULL;
        `);
        
        await knex.raw(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_date_location_null_brand 
          ON reports (report_date, location)
          WHERE brand_id IS NULL;
        `);
      } catch (error) {
        // Agar index allaqachon mavjud bo'lsa, xatolikni e'tiborsiz qoldiramiz
        if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
          throw error;
        }
      }
    } else {
      // SQLite uchun unique constraint (partial index qo'llab bo'lmaydi, shuning uchun trigger ishlatamiz)
      // Yoki faqat application level'da validatsiya qilamiz
      // SQLite'da partial unique index qo'llab bo'lmaydi, shuning uchun application level'da validatsiya yetarli
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  const isPostgres = knex.client.config.client === 'postgresql' || knex.client.config.client === 'pg';
  
  if (isPostgres) {
    return knex.raw(`
      DROP INDEX IF EXISTS idx_reports_unique_date_location_brand;
      DROP INDEX IF EXISTS idx_reports_unique_date_location_null_brand;
    `);
  }
  // SQLite uchun hech narsa qilmaymiz
};

