/**
 * Additional Performance Indexes Migration
 * Qo'shimcha database optimizatsiyalari
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const client = knex.client.config.client;
  const isPostgres = client === 'pg';
  
  // Helper function: Index yaratish (xatoni e'tiborsiz qoldirish)
  const createIndexSafe = async (tableName, indexName, columnOrColumns) => {
    try {
      // PostgreSQL'da index mavjudligini tekshirish
      if (isPostgres) {
        try {
          const result = await knex.raw(`
            SELECT 1 FROM pg_indexes 
            WHERE tablename = ? AND indexname = ?
          `, [tableName, indexName]);
          if (result.rows && result.rows.length > 0) {
            return; // Index allaqachon mavjud
          }
        } catch (checkErr) {
          // Tekshirishda xato - index mavjud emas, yaratishga harakat qilamiz
        }
      }
      
      // Index yaratish
      await knex.schema.table(tableName, function(table) {
        if (Array.isArray(columnOrColumns)) {
          table.index(columnOrColumns, indexName);
        } else {
          table.index(columnOrColumns, indexName);
        }
      });
    } catch (err) {
      // Index allaqachon mavjud yoki boshqa xato - e'tiborsiz qoldirish
      // Index allaqachon mavjud yoki boshqa xato - e'tiborsiz qoldirish (log qilmaymiz)
    }
  };

  // Magic links indexes
  const hasMagicLinksTable = await knex.schema.hasTable('magic_links');
  if (hasMagicLinksTable) {
    await createIndexSafe('magic_links', 'idx_magic_links_expires', 'expires_at');
    await createIndexSafe('magic_links', 'idx_magic_links_user', 'user_id');
  }

  // Notifications indexes
  const hasNotificationsTable = await knex.schema.hasTable('notifications');
  if (hasNotificationsTable) {
    await createIndexSafe('notifications', 'idx_notifications_user', 'user_id');
    await createIndexSafe('notifications', 'idx_notifications_created_at', 'created_at');
    await createIndexSafe('notifications', 'idx_notifications_user_created', ['user_id', 'created_at']);
    await createIndexSafe('notifications', 'idx_notifications_is_read', 'is_read');
  }

  // Comparisons indexes
  const hasComparisonsTable = await knex.schema.hasTable('comparisons');
  if (hasComparisonsTable) {
    await createIndexSafe('comparisons', 'idx_comparisons_date', 'comparison_date');
    await createIndexSafe('comparisons', 'idx_comparisons_brand', 'brand_id');
    await createIndexSafe('comparisons', 'idx_comparisons_date_brand', ['comparison_date', 'brand_id']);
    await createIndexSafe('comparisons', 'idx_comparisons_location', 'location');
  }

  // Exchange rates indexes
  const hasExchangeRatesTable = await knex.schema.hasTable('exchange_rates');
  if (hasExchangeRatesTable) {
    await createIndexSafe('exchange_rates', 'idx_exchange_rates_date', 'date');
    await createIndexSafe('exchange_rates', 'idx_exchange_rates_composite', ['base_currency', 'target_currency', 'date']);
  }

  // Pivot templates indexes
  const hasPivotTemplatesTable = await knex.schema.hasTable('pivot_templates');
  if (hasPivotTemplatesTable) {
    try {
      const columns = await knex('pivot_templates').columnInfo();
      const hasIsPublic = columns && columns.is_public;
      
      await createIndexSafe('pivot_templates', 'idx_pivot_templates_created_by', 'created_by');
      
      if (hasIsPublic) {
        await createIndexSafe('pivot_templates', 'idx_pivot_templates_is_public', 'is_public');
      }
    } catch (err) {
      // Xatoni e'tiborsiz qoldirish - migration'da ortiqcha loglar
    }
  }
};

/**
 * Indexes ni olib tashlash (rollback)
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Helper function: Index o'chirish (xatoni e'tiborsiz qoldirish)
  const dropIndexSafe = async (tableName, indexName) => {
    try {
      await knex.schema.table(tableName, function(table) {
        table.dropIndex(indexName);
      });
    } catch (err) {
      // Index mavjud emas yoki boshqa xato - e'tiborsiz qoldirish
      // Index o'chirishda xato - e'tiborsiz qoldirish (migration'da ortiqcha loglar)
    }
  };

  // Magic links indexes
  const hasMagicLinksTable = await knex.schema.hasTable('magic_links');
  if (hasMagicLinksTable) {
    await dropIndexSafe('magic_links', 'idx_magic_links_expires');
    await dropIndexSafe('magic_links', 'idx_magic_links_user');
  }

  // Notifications indexes
  const hasNotificationsTable = await knex.schema.hasTable('notifications');
  if (hasNotificationsTable) {
    await dropIndexSafe('notifications', 'idx_notifications_user');
    await dropIndexSafe('notifications', 'idx_notifications_created_at');
    await dropIndexSafe('notifications', 'idx_notifications_user_created');
    await dropIndexSafe('notifications', 'idx_notifications_is_read');
  }

  // Comparisons indexes
  const hasComparisonsTable = await knex.schema.hasTable('comparisons');
  if (hasComparisonsTable) {
    await dropIndexSafe('comparisons', 'idx_comparisons_date');
    await dropIndexSafe('comparisons', 'idx_comparisons_brand');
    await dropIndexSafe('comparisons', 'idx_comparisons_date_brand');
    await dropIndexSafe('comparisons', 'idx_comparisons_location');
  }

  // Exchange rates indexes
  const hasExchangeRatesTable = await knex.schema.hasTable('exchange_rates');
  if (hasExchangeRatesTable) {
    await dropIndexSafe('exchange_rates', 'idx_exchange_rates_date');
    await dropIndexSafe('exchange_rates', 'idx_exchange_rates_composite');
  }

  // Pivot templates indexes
  const hasPivotTemplatesTable = await knex.schema.hasTable('pivot_templates');
  if (hasPivotTemplatesTable) {
    await dropIndexSafe('pivot_templates', 'idx_pivot_templates_created_by');
    await dropIndexSafe('pivot_templates', 'idx_pivot_templates_is_public');
  }
};
