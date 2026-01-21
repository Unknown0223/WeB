/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Har bir rol uchun default knopkalar guruhlarini yaratish
    // Mantiqiy guruhlash: qaysi knopka qaysi rolda ishlatiladi
    
    // Rol-knopka mapping'i (permission bo'yicha)
    // Rol nomlarini database'dan tekshirish kerak (menejer/menejerlar, kassir/kassirlar, operator/operatorlar, rahbar/rahbarlar)
    const roleButtonGroups = {
        // Menejer - debt:create permission (menejer yoki menejerlar)
        'menejer': [
            'new_request',           // ➕ Yangi so'rov
            'set_request',           // 💾 SET (Muddat uzaytirish)
            'my_requests',           // 📋 Mening so'rovlarim
            'in_process_requests',   // ⏳ Jarayondagi so'rovlar
            'approved_requests',     // ✅ Tasdiqlangan so'rovlar
            'branch_stats'           // 📊 Brend va Filiallar statistikasi
        ],
        'menejerlar': [
            'new_request',           // ➕ Yangi so'rov
            'set_request',           // 💾 SET (Muddat uzaytirish)
            'my_requests',           // 📋 Mening so'rovlarim
            'in_process_requests',   // ⏳ Jarayondagi so'rovlar
            'approved_requests',     // ✅ Tasdiqlangan so'rovlar
            'branch_stats'           // 📊 Brend va Filiallar statistikasi
        ],
        
        // Kassir - debt:approve_cashier permission (kassir yoki kassirlar)
        'kassir': [
            'new_requests_cashier',      // 📥 Yangi so'rovlar
            'my_requests_cashier',       // 📋 Mening so'rovlarim
            'pending_requests_cashier'   // ⏰ Kutayotgan so'rovlar
        ],
        'kassirlar': [
            'new_requests_cashier',      // 📥 Yangi so'rovlar
            'my_requests_cashier',       // 📋 Mening so'rovlarim
            'pending_requests_cashier'   // ⏰ Kutayotgan so'rovlar
        ],
        
        // Operator - debt:approve_operator permission (operator yoki operatorlar)
        'operator': [
            'new_requests_operator',     // 📥 Yangi so'rovlar
            'my_requests_operator',      // 📋 Mening so'rovlarim
            'pending_requests_operator'  // ⏰ Kutayotgan so'rovlar
        ],
        'operatorlar': [
            'new_requests_operator',     // 📥 Yangi so'rovlar
            'my_requests_operator',      // 📋 Mening so'rovlarim
            'pending_requests_operator'  // ⏰ Kutayotgan so'rovlar
        ],
        
        // Rahbar - debt:approve_leader permission (rahbar yoki rahbarlar)
        'rahbar': [
            'set_requests_leader',       // 📥 SET so'rovlari
            'approved_requests_leader',  // 📋 Tasdiqlangan so'rovlar
            'block_leader'               // 🚫 Bloklash
        ],
        'rahbarlar': [
            'set_requests_leader',       // 📥 SET so'rovlari
            'approved_requests_leader',  // 📋 Tasdiqlangan so'rovlar
            'block_leader'               // 🚫 Bloklash
        ],
        
        // Nazoratchi - debt:approve_supervisor permission
        'nazoratchi': [
            'supervisor_requests',       // 📥 Nazorat so'rovlari
            'supervisor_approved'        // 📋 Nazorat qilingan so'rovlar
        ],
        
        // Admin - debt:block, debt:admin permissions
        'admin': [
            'block',                     // 🚫 Bloklash
            'settings'                   // ⚙️ Sozlamalar
        ]
    };
    
    // Button key'larini ID'larga o'tkazish
    const buttonKeyToId = {};
    const buttons = await knex('bot_menu_buttons').select('id', 'button_key');
    buttons.forEach(btn => {
        buttonKeyToId[btn.button_key] = btn.id;
    });
    
    // Har bir rol uchun knopkalarni qo'shish
    for (const [roleName, buttonKeys] of Object.entries(roleButtonGroups)) {
        // Rol mavjudligini tekshirish
        const roleExists = await knex('roles').where('role_name', roleName).first();
        if (!roleExists) {
            console.log(`⚠️  Rol "${roleName}" topilmadi, o'tkazib yuborilmoqda`);
            continue;
        }
        
        // Rol uchun mavjud sozlamalarni olish
        const existingSettings = await knex('bot_role_button_settings')
            .where('role_name', roleName)
            .select('button_id');
        
        const existingButtonIds = new Set(existingSettings.map(s => s.button_id));
        
        // Har bir knopka uchun sozlama yaratish
        for (let i = 0; i < buttonKeys.length; i++) {
            const buttonKey = buttonKeys[i];
            const buttonId = buttonKeyToId[buttonKey];
            
            if (!buttonId) {
                console.log(`⚠️  Knopka "${buttonKey}" topilmadi, o'tkazib yuborilmoqda`);
                continue;
            }
            
            // Agar allaqachon mavjud bo'lsa, o'tkazib yuborish
            if (existingButtonIds.has(buttonId)) {
                continue;
            }
            
            // Button ma'lumotlarini olish (order_index uchun)
            const button = buttons.find(b => b.id === buttonId);
            const orderIndex = button ? (button.order_index || i) : i;
            
            // Sozlamani qo'shish
            try {
                await knex('bot_role_button_settings').insert({
                    role_name: roleName,
                    button_id: buttonId,
                    is_visible: true,
                    order_index: orderIndex,
                    created_at: knex.fn.now(),
                    updated_at: knex.fn.now()
                });
            } catch (error) {
                // Duplicate key error - o'tkazib yuborish
                if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505' || error.message?.includes('unique')) {
                    continue;
                }
                throw error;
            }
        }
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Rol-knopka mapping'i (up funksiyasidagi bilan bir xil)
    const roleButtonGroups = {
        'menejer': ['new_request', 'set_request', 'my_requests', 'in_process_requests', 'approved_requests', 'branch_stats'],
        'menejerlar': ['new_request', 'set_request', 'my_requests', 'in_process_requests', 'approved_requests', 'branch_stats'],
        'kassir': ['new_requests_cashier', 'my_requests_cashier', 'pending_requests_cashier'],
        'kassirlar': ['new_requests_cashier', 'my_requests_cashier', 'pending_requests_cashier'],
        'operator': ['new_requests_operator', 'my_requests_operator', 'pending_requests_operator'],
        'operatorlar': ['new_requests_operator', 'my_requests_operator', 'pending_requests_operator'],
        'rahbar': ['set_requests_leader', 'approved_requests_leader', 'block_leader'],
        'rahbarlar': ['set_requests_leader', 'approved_requests_leader', 'block_leader'],
        'nazoratchi': ['supervisor_requests', 'supervisor_approved'],
        'admin': ['block', 'settings']
    };
    
    // Button key'larini ID'larga o'tkazish
    const buttonKeyToId = {};
    const buttons = await knex('bot_menu_buttons').select('id', 'button_key');
    buttons.forEach(btn => {
        buttonKeyToId[btn.button_key] = btn.id;
    });
    
    // Har bir rol uchun knopkalarni o'chirish
    for (const [roleName, buttonKeys] of Object.entries(roleButtonGroups)) {
        const buttonIds = buttonKeys
            .map(key => buttonKeyToId[key])
            .filter(id => id !== undefined);
        
        if (buttonIds.length > 0) {
            await knex('bot_role_button_settings')
                .where('role_name', roleName)
                .whereIn('button_id', buttonIds)
                .delete();
        }
    }
};

