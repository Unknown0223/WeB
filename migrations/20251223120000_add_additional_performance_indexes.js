/**
 * Additional Performance Indexes Migration
 * Qo'shimcha database optimizatsiyalari
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Magic links - expires_at bo'yicha tez qidiruv (token cleanup uchun)
  const hasMagicLinksTable = await knex.schema.hasTable('magic_links');
  if (hasMagicLinksTable) {
    try {
      await knex.schema.table('magic_links', function(table) {
        table.index('expires_at', 'idx_magic_links_expires');
        table.index('user_id', 'idx_magic_links_user');
      });
    } catch (err) {
      console.warn('Magic links indexes qo\'shishda xato:', err.message);
    }
  }

  // Notifications - user_id + created_at composite (eng ko'p ishlatiladi)
  const hasNotificationsTable = await knex.schema.hasTable('notifications');
  if (hasNotificationsTable) {
    try {
      await knex.schema.table('notifications', function(table) {
        table.index('user_id', 'idx_notifications_user');
        table.index('created_at', 'idx_notifications_created_at');
        table.index(['user_id', 'created_at'], 'idx_notifications_user_created');
        table.index('is_read', 'idx_notifications_is_read');
      });
    } catch (err) {
      console.warn('Notifications indexes qo\'shishda xato:', err.message);
    }
  }

  // Comparisons - date + brand_id composite (eng ko'p ishlatiladi)
  const hasComparisonsTable = await knex.schema.hasTable('comparisons');
  if (hasComparisonsTable) {
    try {
      await knex.schema.table('comparisons', function(table) {
        table.index('comparison_date', 'idx_comparisons_date');
        table.index('brand_id', 'idx_comparisons_brand');
        table.index(['comparison_date', 'brand_id'], 'idx_comparisons_date_brand');
        table.index('location', 'idx_comparisons_location');
      });
    } catch (err) {
      console.warn('Comparisons indexes qo\'shishda xato:', err.message);
    }
  }

  // Exchange rates - date bo'yicha tez qidiruv
  const hasExchangeRatesTable = await knex.schema.hasTable('exchange_rates');
  if (hasExchangeRatesTable) {
    try {
      await knex.schema.table('exchange_rates', function(table) {
        table.index('date', 'idx_exchange_rates_date');
        table.index(['base_currency', 'target_currency', 'date'], 'idx_exchange_rates_composite');
      });
    } catch (err) {
      console.warn('Exchange rates indexes qo\'shishda xato:', err.message);
    }
  }

  // Pivot templates - created_by + is_public (filter uchun)
  const hasPivotTemplatesTable = await knex.schema.hasTable('pivot_templates');
  if (hasPivotTemplatesTable) {
    try {
      // is_public ustuni mavjudligini tekshirish
      const columns = await knex('pivot_templates').columnInfo();
      const hasIsPublic = columns && columns.is_public;
      
      await knex.schema.table('pivot_templates', function(table) {
        table.index('created_by', 'idx_pivot_templates_created_by');
        // is_public ustuni mavjud bo'lsa
        if (hasIsPublic) {
          table.index('is_public', 'idx_pivot_templates_is_public');
        }
      });
    } catch (err) {
      console.warn('Pivot templates indexes qo\'shishda xato:', err.message);
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
  // Magic links indexes
  const hasMagicLinksTable = await knex.schema.hasTable('magic_links');
  if (hasMagicLinksTable) {
    try {
      await knex.schema.table('magic_links', function(table) {
        table.dropIndex('idx_magic_links_expires');
        table.dropIndex('idx_magic_links_user');
      });
    } catch (err) {
      console.warn('Magic links indexes o\'chirishda xato:', err.message);
    }
  }

  // Notifications indexes
  const hasNotificationsTable = await knex.schema.hasTable('notifications');
  if (hasNotificationsTable) {
    try {
      await knex.schema.table('notifications', function(table) {
        table.dropIndex('idx_notifications_user');
        table.dropIndex('idx_notifications_created_at');
        table.dropIndex('idx_notifications_user_created');
        table.dropIndex('idx_notifications_is_read');
      });
    } catch (err) {
      console.warn('Notifications indexes o\'chirishda xato:', err.message);
    }
  }

  // Comparisons indexes
  const hasComparisonsTable = await knex.schema.hasTable('comparisons');
  if (hasComparisonsTable) {
    try {
      await knex.schema.table('comparisons', function(table) {
        table.dropIndex('idx_comparisons_date');
        table.dropIndex('idx_comparisons_brand');
        table.dropIndex('idx_comparisons_date_brand');
        table.dropIndex('idx_comparisons_location');
      });
    } catch (err) {
      console.warn('Comparisons indexes o\'chirishda xato:', err.message);
    }
  }

  // Exchange rates indexes
  const hasExchangeRatesTable = await knex.schema.hasTable('exchange_rates');
  if (hasExchangeRatesTable) {
    try {
      await knex.schema.table('exchange_rates', function(table) {
        table.dropIndex('idx_exchange_rates_date');
        table.dropIndex('idx_exchange_rates_composite');
      });
    } catch (err) {
      console.warn('Exchange rates indexes o\'chirishda xato:', err.message);
    }
  }

  // Pivot templates indexes
  const hasPivotTemplatesTable = await knex.schema.hasTable('pivot_templates');
  if (hasPivotTemplatesTable) {
    try {
      await knex.schema.table('pivot_templates', function(table) {
        table.dropIndex('idx_pivot_templates_created_by');
        try {
          table.dropIndex('idx_pivot_templates_is_public');
        } catch (err) {
          // Index mavjud bo'lmasa, xato berilmasin
        }
      });
    } catch (err) {
      console.warn('Pivot templates indexes o\'chirishda xato:', err.message);
    }
  }
};

