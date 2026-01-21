/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Idempotent migration - jadval mavjudligini tekshirish
    const hasBotMenuButtons = await knex.schema.hasTable('bot_menu_buttons');
    const hasBotRoleButtonSettings = await knex.schema.hasTable('bot_role_button_settings');
    
    if (!hasBotMenuButtons) {
        await knex.schema.createTable('bot_menu_buttons', function (table) {
            table.increments('id').primary();
            table.string('button_key').notNullable().unique(); // Masalan: 'new_request', 'set_request'
            table.string('button_text').notNullable(); // Masalan: "➕ Yangi so'rov"
            table.string('category').notNullable(); // Masalan: 'debt_approval', 'reports'
            table.string('permission_required').nullable(); // Masalan: 'debt:create'
            table.boolean('is_active').defaultTo(true);
            table.integer('order_index').defaultTo(0);
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
        });
    }
    
    if (!hasBotRoleButtonSettings) {
        await knex.schema.createTable('bot_role_button_settings', function (table) {
            table.increments('id').primary();
            table.string('role_name').notNullable();
            table.integer('button_id').references('id').inTable('bot_menu_buttons').onDelete('CASCADE');
            table.boolean('is_visible').defaultTo(true);
            table.integer('order_index').defaultTo(0);
            table.unique(['role_name', 'button_id']);
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
        });
    }
    
    // Default knopkalarni qo'shish (faqat agar jadval bo'sh bo'lsa)
    const existingButtons = await knex('bot_menu_buttons').count('* as count').first();
    const buttonCount = parseInt(existingButtons?.count || 0);
    
    if (buttonCount === 0) {
        const defaultButtons = [
            // Debt-approval knopkalari
            { button_key: 'new_request', button_text: "➕ Yangi so'rov", category: 'debt_approval', permission_required: 'debt:create', order_index: 1 },
            { button_key: 'set_request', button_text: "💾 SET (Muddat uzaytirish)", category: 'debt_approval', permission_required: 'debt:create', order_index: 2 },
            { button_key: 'my_requests', button_text: "📋 Mening so'rovlarim", category: 'debt_approval', permission_required: 'debt:create', order_index: 3 },
            { button_key: 'in_process_requests', button_text: "⏳ Jarayondagi so'rovlar", category: 'debt_approval', permission_required: 'debt:create', order_index: 4 },
            { button_key: 'approved_requests', button_text: "✅ Tasdiqlangan so'rovlar", category: 'debt_approval', permission_required: 'debt:create', order_index: 5 },
            { button_key: 'branch_stats', button_text: "📊 Brend va Filiallar statistikasi", category: 'debt_approval', permission_required: 'debt:create', order_index: 6 },
            { button_key: 'block', button_text: "🚫 Bloklash", category: 'debt_approval', permission_required: 'debt:block', order_index: 7 },
            { button_key: 'new_requests_cashier', button_text: "📥 Yangi so'rovlar", category: 'debt_approval', permission_required: 'debt:approve_cashier', order_index: 10 },
            { button_key: 'my_requests_cashier', button_text: "📋 Mening so'rovlarim", category: 'debt_approval', permission_required: 'debt:approve_cashier', order_index: 11 },
            { button_key: 'pending_requests_cashier', button_text: "⏰ Kutayotgan so'rovlar", category: 'debt_approval', permission_required: 'debt:approve_cashier', order_index: 12 },
            { button_key: 'new_requests_operator', button_text: "📥 Yangi so'rovlar", category: 'debt_approval', permission_required: 'debt:approve_operator', order_index: 20 },
            { button_key: 'my_requests_operator', button_text: "📋 Mening so'rovlarim", category: 'debt_approval', permission_required: 'debt:approve_operator', order_index: 21 },
            { button_key: 'pending_requests_operator', button_text: "⏰ Kutayotgan so'rovlar", category: 'debt_approval', permission_required: 'debt:approve_operator', order_index: 22 },
            { button_key: 'set_requests_leader', button_text: "📥 SET so'rovlari", category: 'debt_approval', permission_required: 'debt:approve_leader', order_index: 30 },
            { button_key: 'approved_requests_leader', button_text: "📋 Tasdiqlangan so'rovlar", category: 'debt_approval', permission_required: 'debt:approve_leader', order_index: 31 },
            { button_key: 'block_leader', button_text: "🚫 Bloklash", category: 'debt_approval', permission_required: 'debt:block', order_index: 32 },
            { button_key: 'supervisor_requests', button_text: "📥 Nazorat so'rovlari", category: 'debt_approval', permission_required: 'debt:approve_supervisor', order_index: 40 },
            { button_key: 'supervisor_approved', button_text: "📋 Nazorat qilingan so'rovlar", category: 'debt_approval', permission_required: 'debt:approve_supervisor', order_index: 41 },
            { button_key: 'settings', button_text: "⚙️ Sozlamalar", category: 'system', permission_required: 'debt:admin', order_index: 100 },
            // Reports knopkalari
            { button_key: 'reports_list', button_text: "📊 Hisobotlar ro'yxati", category: 'reports', permission_required: 'reports:view_own', order_index: 200 },
            { button_key: 'new_report', button_text: "➕ Yangi hisobot", category: 'reports', permission_required: 'reports:create', order_index: 201 },
            { button_key: 'reports_set', button_text: "💾 SET (Muddat uzaytirish)", category: 'reports', permission_required: 'reports:create', order_index: 202 },
            { button_key: 'reports_stats', button_text: "📈 Statistika", category: 'reports', permission_required: 'reports:view_own', order_index: 203 }
        ];

        for (const btn of defaultButtons) {
            try {
                await knex('bot_menu_buttons').insert(btn);
            } catch (error) {
                // Ignore duplicate key errors
                if (!error.message || (!error.message.includes('duplicate') && !error.message.includes('unique'))) {
                    throw error;
                }
            }
        }
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
        .dropTableIfExists('bot_role_button_settings')
        .dropTableIfExists('bot_menu_buttons');
};
