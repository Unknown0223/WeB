/**
 * Performance Indexes Migration
 * Database query tezligini 5-10x oshiradi
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Reports jadvali - eng ko'p ishlatiladi
  await knex.schema.table('reports', function(table) {
    // Sana bo'yicha qidiruv (filter, sort)
    table.index('report_date', 'idx_reports_date');
    
    // Foydalanuvchi bo'yicha qidiruv
    table.index('created_by', 'idx_reports_created_by');
    
    // Location bo'yicha qidiruv
    table.index('location', 'idx_reports_location');
    
    // Composite index - location + date (eng ko'p ishlatiladi)
    table.index(['location', 'report_date'], 'idx_reports_location_date');
    
    // Brand bo'yicha qidiruv
    table.index('brand_id', 'idx_reports_brand');
  });

  // Users jadvali
  await knex.schema.table('users', function(table) {
    // Username bo'yicha qidiruv (login, search)
    table.index('username', 'idx_users_username');
    
    // Role bo'yicha qidiruv (filter)
    table.index('role', 'idx_users_role');
    
    // Status bo'yicha qidiruv
    table.index('status', 'idx_users_status');
  });

  // Audit logs - ko'p ma'lumot
  await knex.schema.table('audit_logs', function(table) {
    // User bo'yicha qidiruv
    table.index('user_id', 'idx_audit_user');
    
    // Action bo'yicha qidiruv
    table.index('action', 'idx_audit_action');
    
    // Sana bo'yicha qidiruv (eng ko'p ishlatiladi) - timestamp ustuni
    table.index('timestamp', 'idx_audit_timestamp');
    
    // Composite - user + date
    table.index(['user_id', 'timestamp'], 'idx_audit_user_timestamp');
  });

  // Sessions - express-session SQLiteStore tomonidan yaratiladi
  // Agar jadval mavjud bo'lsa, index qo'shamiz
  const hasSessionsTable = await knex.schema.hasTable('sessions');
  if (hasSessionsTable) {
    const sessionsColumns = await knex('sessions').columnInfo();
    if (sessionsColumns.user_id) {
      await knex.schema.table('sessions', function(table) {
        table.index('user_id', 'idx_sessions_user');
      });
    }
    if (sessionsColumns.expires) {
      await knex.schema.table('sessions', function(table) {
        table.index('expires', 'idx_sessions_expires');
      });
    }
  }

  // History - reports o'zgarishlar tarixi (report_history jadvali)
  const hasHistoryTable = await knex.schema.hasTable('report_history');
  if (hasHistoryTable) {
    await knex.schema.table('report_history', function(table) {
      table.index('report_id', 'idx_history_report');
      table.index('changed_at', 'idx_history_changed_at');
    });
  }

  // Role permissions - tez tekshirish uchun
  await knex.schema.table('role_permissions', function(table) {
    table.index('role_name', 'idx_role_perms_role');
    table.index('permission_key', 'idx_role_perms_perm');
  });

  // User permissions - tez tekshirish uchun
  const hasUserPermissions = await knex.schema.hasTable('user_permissions');
  if (hasUserPermissions) {
    await knex.schema.table('user_permissions', function(table) {
      table.index('user_id', 'idx_user_perms_user');
      table.index('permission_key', 'idx_user_perms_perm');
    });
  }
};

/**
 * Indexes ni olib tashlash (rollback)
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Reports indexes
  await knex.schema.table('reports', function(table) {
    table.dropIndex('idx_reports_date');
    table.dropIndex('idx_reports_created_by');
    table.dropIndex('idx_reports_location');
    table.dropIndex('idx_reports_location_date');
    table.dropIndex('idx_reports_brand');
  });

  // Users indexes
  await knex.schema.table('users', function(table) {
    table.dropIndex('idx_users_username');
    table.dropIndex('idx_users_role');
    table.dropIndex('idx_users_status');
  });

  // Audit logs indexes
  await knex.schema.table('audit_logs', function(table) {
    table.dropIndex('idx_audit_user');
    table.dropIndex('idx_audit_action');
    table.dropIndex('idx_audit_timestamp');
    table.dropIndex('idx_audit_user_timestamp');
  });

  // Sessions indexes
  const hasSessionsTable = await knex.schema.hasTable('sessions');
  if (hasSessionsTable) {
    try {
      await knex.schema.table('sessions', function(table) {
        table.dropIndex('idx_sessions_user');
        table.dropIndex('idx_sessions_expires');
      });
    } catch (err) {
      // Index mavjud bo'lmasa, xato berilmasin
      console.warn('Sessions indexes o\'chirishda xato:', err.message);
    }
  }

  // History indexes
  const hasHistoryTable = await knex.schema.hasTable('report_history');
  if (hasHistoryTable) {
    await knex.schema.table('report_history', function(table) {
      table.dropIndex('idx_history_report');
      table.dropIndex('idx_history_changed_at');
    });
  }

  // Role permissions indexes
  await knex.schema.table('role_permissions', function(table) {
    table.dropIndex('idx_role_perms_role');
    table.dropIndex('idx_role_perms_perm');
  });

  // User permissions indexes
  const hasUserPermissions = await knex.schema.hasTable('user_permissions');
  if (hasUserPermissions) {
    await knex.schema.table('user_permissions', function(table) {
      table.dropIndex('idx_user_perms_user');
      table.dropIndex('idx_user_perms_perm');
    });
  }
};
