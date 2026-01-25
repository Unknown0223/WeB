/**
 * Kengaytirilgan huquqlar ro'yxati
 * Har bir modul uchun elementar huquqlar
 */

const { createLogger } = require('../utils/logger.js');
const log = createLogger('SEEDS');

exports.seed = async function(knex) {
  // Yangi huquqlarni qo'shish (mavjudlari update qilish)
  const permissions = [
    // ============ DASHBOARD (Boshqaruv Paneli) ============
    { 
      permission_key: 'dashboard:view', 
      description: 'Boshqaruv panelini ko\'rish', 
      category: 'Boshqaruv Paneli' 
    },
    { 
      permission_key: 'dashboard:view_statistics', 
      description: 'Statistika kartalarini ko\'rish', 
      category: 'Boshqaruv Paneli' 
    },
    { 
      permission_key: 'dashboard:view_charts', 
      description: 'Grafiklarni ko\'rish', 
      category: 'Boshqaruv Paneli' 
    },
    { 
      permission_key: 'dashboard:export_data', 
      description: 'Dashboard ma\'lumotlarini eksport qilish', 
      category: 'Boshqaruv Paneli' 
    },
    { 
      permission_key: 'dashboard:customize', 
      description: 'Dashboard ni sozlash (widget qo\'shish/olib tashlash)', 
      category: 'Boshqaruv Paneli' 
    },

    // ============ HISOBOTLAR (Reports) ============
    { 
      permission_key: 'reports:view_all', 
      description: 'Barcha hisobotlarni ko\'rish', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:view_assigned', 
      description: 'Biriktirilgan filial hisobotlarini ko\'rish', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:view_own', 
      description: 'Faqat o\'z hisobotlarini ko\'rish', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:create', 
      description: 'Yangi hisobot yaratish', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:edit_all', 
      description: 'Barcha hisobotlarni tahrirlash', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:edit_assigned', 
      description: 'Biriktirilgan filial hisobotlarini tahrirlash', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:edit_own', 
      description: 'Faqat o\'z hisobotlarini tahrirlash', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:delete_all', 
      description: 'Barcha hisobotlarni o\'chirish', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:delete_assigned', 
      description: 'Biriktirilgan filial hisobotlarini o\'chirish', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:delete_own', 
      description: 'Faqat o\'z hisobotlarini o\'chirish', 
      category: 'Hisobotlar' 
    },
    { 
      permission_key: 'reports:export', 
      description: 'Hisobotlarni eksport qilish (Excel, PDF)', 
      category: 'Hisobotlar' 
    },

    // ============ KPI (Ko'rsatkichlar) ============
    { 
      permission_key: 'kpi:view', 
      description: 'KPI jadvalini ko\'rish', 
      category: 'KPI' 
    },
    { 
      permission_key: 'kpi:edit', 
      description: 'KPI ma\'lumotlarini tahrirlash', 
      category: 'KPI' 
    },
    { 
      permission_key: 'kpi:view_calendar', 
      description: 'Hodim kalendari ko\'rish', 
      category: 'KPI' 
    },
    { 
      permission_key: 'kpi:export', 
      description: 'KPI ma\'lumotlarini eksport qilish', 
      category: 'KPI' 
    },

    // ============ FOYDALANUVCHILAR (Users) ============
    { 
      permission_key: 'users:view', 
      description: 'Foydalanuvchilar ro\'yxatini ko\'rish', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:create', 
      description: 'Yangi foydalanuvchi qo\'shish', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:edit', 
      description: 'Foydalanuvchi ma\'lumotlarini tahrirlash', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:delete', 
      description: 'Foydalanuvchilarni o\'chirish', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:change_password', 
      description: 'Foydalanuvchi parolini o\'zgartirish', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:change_secret', 
      description: 'Maxfiy so\'zni o\'zgartirish', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:block', 
      description: 'Foydalanuvchilarni bloklash', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:archive', 
      description: 'Foydalanuvchilarni arxivlash', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:view_sessions', 
      description: 'Foydalanuvchi sessiyalarini ko\'rish', 
      category: 'Foydalanuvchilar' 
    },
    { 
      permission_key: 'users:terminate_sessions', 
      description: 'Sessiyalarni tugatish', 
      category: 'Foydalanuvchilar' 
    },

    // ============ ROLLAR VA HUQUQLAR (Roles) ============
    { 
      permission_key: 'roles:view', 
      description: 'Rollar ro\'yxatini ko\'rish', 
      category: 'Rollar va Huquqlar' 
    },
    { 
      permission_key: 'roles:manage', 
      description: 'Rollar va huquqlarni boshqarish', 
      category: 'Rollar va Huquqlar' 
    },
    { 
      permission_key: 'roles:create', 
      description: 'Yangi rol yaratish', 
      category: 'Rollar va Huquqlar' 
    },
    { 
      permission_key: 'roles:delete', 
      description: 'Rollarni o\'chirish', 
      category: 'Rollar va Huquqlar' 
    },
    { 
      permission_key: 'roles:assign_permissions', 
      description: 'Rollarga huquqlar biriktirish', 
      category: 'Rollar va Huquqlar' 
    },
    { 
      permission_key: 'roles:assign_user_permissions', 
      description: 'Alohida foydalanuvchilarga huquq berish', 
      category: 'Rollar va Huquqlar' 
    },

    // ============ SOZLAMALAR (Settings) ============
    { 
      permission_key: 'settings:view', 
      description: 'Sozlamalarni ko\'rish', 
      category: 'Sozlamalar' 
    },
    { 
      permission_key: 'settings:edit_general', 
      description: 'Umumiy sozlamalarni o\'zgartirish', 
      category: 'Sozlamalar' 
    },
    { 
      permission_key: 'settings:edit_table', 
      description: 'Jadval sozlamalarini o\'zgartirish', 
      category: 'Sozlamalar' 
    },
    { 
      permission_key: 'settings:edit_telegram', 
      description: 'Telegram sozlamalarini o\'zgartirish', 
      category: 'Sozlamalar' 
    },
    { 
      permission_key: 'settings:edit_kpi', 
      description: 'KPI sozlamalarini o\'zgartirish', 
      category: 'Sozlamalar' 
    },
    { 
      permission_key: 'settings:manage_locations', 
      description: 'Filiallarni boshqarish', 
      category: 'Sozlamalar' 
    },
    { 
      permission_key: 'settings:manage_brands', 
      description: 'Brendlarni boshqarish', 
      category: 'Sozlamalar' 
    },

    // ============ TIZIM JURNALI (Audit Log) ============
    { 
      permission_key: 'audit:view', 
      description: 'Tizim jurnalini ko\'rish', 
      category: 'Tizim Jurnali' 
    },
    { 
      permission_key: 'audit:export', 
      description: 'Audit loglarni eksport qilish', 
      category: 'Tizim Jurnali' 
    },
    { 
      permission_key: 'audit:delete', 
      description: 'Audit loglarni o\'chirish', 
      category: 'Tizim Jurnali' 
    },

    // ============ PIVOT JADVAL (Pivot Tables) ============
    { 
      permission_key: 'pivot:view', 
      description: 'Pivot jadvallarni ko\'rish', 
      category: 'Pivot Jadval' 
    },
    { 
      permission_key: 'pivot:create_template', 
      description: 'Yangi shablon yaratish', 
      category: 'Pivot Jadval' 
    },
    { 
      permission_key: 'pivot:edit_template', 
      description: 'Shablonlarni tahrirlash', 
      category: 'Pivot Jadval' 
    },
    { 
      permission_key: 'pivot:delete_template', 
      description: 'Shablonlarni o\'chirish', 
      category: 'Pivot Jadval' 
    },
    { 
      permission_key: 'pivot:export', 
      description: 'Pivot ma\'lumotlarini eksport qilish', 
      category: 'Pivot Jadval' 
    },

    // ============ BRENDLAR (Brands) ============
    { 
      permission_key: 'brands:view', 
      description: 'Brendlar ro\'yxatini ko\'rish', 
      category: 'Brendlar' 
    },
    { 
      permission_key: 'brands:create', 
      description: 'Yangi brend qo\'shish', 
      category: 'Brendlar' 
    },
    { 
      permission_key: 'brands:edit', 
      description: 'Brendlarni tahrirlash', 
      category: 'Brendlar' 
    },
    { 
      permission_key: 'brands:delete', 
      description: 'Brendlarni o\'chirish', 
      category: 'Brendlar' 
    },
    { 
      permission_key: 'brands:assign_users', 
      description: 'Brendlarga foydalanuvchi biriktirish', 
      category: 'Brendlar' 
    },

    // ============ QIYMATLARNI SOLISHTIRISH (Comparison) ============
    { 
      permission_key: 'comparison:view', 
      description: 'Qiymatlarni solishtirish bo\'limini ko\'rish', 
      category: 'Qiymatlarni Solishtirish' 
    },
    { 
      permission_key: 'comparison:edit', 
      description: 'Solishtirish summalarini kiritish va saqlash', 
      category: 'Qiymatlarni Solishtirish' 
    },
    { 
      permission_key: 'comparison:export', 
      description: 'Solishtirish natijalarini Excel faylga eksport qilish', 
      category: 'Qiymatlarni Solishtirish' 
    },
    { 
      permission_key: 'comparison:notify', 
      description: 'Farqlar haqida operatorlarga bildirishnoma yuborish', 
      category: 'Qiymatlarni Solishtirish' 
    },

    // ============ TIZIM BOSHQARUVI (System Admin) ============
    { 
      permission_key: 'admin:database_backup', 
      description: 'Ma\'lumotlar bazasini zahiralash', 
      category: 'Tizim Boshqaruvi' 
    },
    { 
      permission_key: 'admin:database_restore', 
      description: 'Ma\'lumotlar bazasini tiklash', 
      category: 'Tizim Boshqaruvi' 
    },
    { 
      permission_key: 'admin:clear_sessions', 
      description: 'Barcha sessiyalarni tozalash', 
      category: 'Tizim Boshqaruvi' 
    },
    { 
      permission_key: 'admin:view_system_info', 
      description: 'Tizim ma\'lumotlarini ko\'rish', 
      category: 'Tizim Boshqaruvi' 
    },

    // ============ QARZDORLIK TASDIQLASH (Debt Approval) ============
    { 
      permission_key: 'debt:view_all', 
      description: 'Barcha qarzdorlik so\'rovlarini ko\'rish', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:view_own', 
      description: 'Faqat o\'z qarzdorlik so\'rovlarini ko\'rish', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:create', 
      description: 'Yangi qarzdorlik so\'rovi yaratish', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:approve_leader', 
      description: 'Leader sifatida SET so\'rovlarni tasdiqlash', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:approve_cashier', 
      description: 'Cashier sifatida so\'rovlarni tasdiqlash', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:approve_operator', 
      description: 'Operator sifatida so\'rovlarni tasdiqlash', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:approve_supervisor', 
      description: 'Nazoratchi sifatida so\'rovlarni tasdiqlash', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:mark_debt', 
      description: 'Qarzdorlik belgilash (Excel, rasm yoki summa kiritish)', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:view_statistics', 
      description: 'Qarzdorlik statistikasini ko\'rish', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:export', 
      description: 'Qarzdorlik ma\'lumotlarini eksport qilish', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:view_bindings', 
      description: 'Qarzdorlik bog\'lanishlarini ko\'rish (brendlar, filiallar, SVR\'lar)', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:manage_bindings', 
      description: 'Qarzdorlik bog\'lanishlarini boshqarish (yaratish/o\'zgartirish/o\'chirish)', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:admin', 
      description: 'Qarzdorlik tizimini to\'liq boshqarish (admin huquqlari)', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:block', 
      description: 'Elementlarni bloklash (brendlar, filiallar, SVR\'lar)', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:unblock', 
      description: 'Bloklashni bekor qilish (brendlar, filiallar, SVR\'lar)', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:bot_activity', 
      description: 'Telegram bot faoliyatini ko\'rish (xabarlar, tasdiqlashlar)', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
    { 
      permission_key: 'debt:bot_manage', 
      description: 'Telegram bot jarayonlarini boshqarish', 
      category: 'Qarzdorlik Tasdiqlash' 
    },
  ];

  // Batch insert/update - barcha permission'larni bir vaqtda ishlash
  // Bu connection pool to'lib qolmasligi uchun muhim
  if (permissions.length > 0) {
    // PostgreSQL va SQLite uchun batch insert
    try {
      // Avval mavjud permission'larni o'chirish (conflict bo'lmasligi uchun)
      // Lekin bu kerak emas, chunki onConflict.merge() ishlatilmoqda
      
      // Batch insert - barcha permission'larni bir vaqtda
      await knex('permissions')
        .insert(permissions)
        .onConflict('permission_key')
        .merge(['description', 'category']);
    } catch (error) {
      // Agar batch insert xatolik bersa, alohida insert qilish (fallback)
      log.warn('Batch insert xatolik, alohida insert qilinmoqda:', error.message);
      for (const perm of permissions) {
        try {
          await knex('permissions')
            .insert(perm)
            .onConflict('permission_key')
            .merge(['description', 'category']);
        } catch (individualError) {
          // Alohida insert ham xatolik bersa, log qilish va davom etish
          log.warn(`Permission insert xatolik (${perm.permission_key}):`, individualError.message);
        }
      }
    }
  }

  // Production'da log qilmaymiz (faqat error loglar)
};
