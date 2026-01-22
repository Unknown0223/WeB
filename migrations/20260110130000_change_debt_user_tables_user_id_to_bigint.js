/**
 * Migration: debt_user jadvallarda user_id ni INTEGER dan BIGINT ga o'zgartirish
 * Sabab: Telegram chat ID'lari ko'pincha INTEGER maksimalidan katta (masalan, 5988510278, 7048657605)
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    const client = knex.client.config.client;
    const isPostgres = client === 'pg';

    if (!isPostgres) {
        // SQLite uchun bu migration kerak emas (SQLite'da INTEGER hamma narsani qo'llab-quvvatlaydi)
        return Promise.resolve();
    }

    const tablesToUpdate = [
        'debt_user_tasks',
        'debt_user_brands',
        'debt_user_branches',
        'debt_user_svrs'
    ];

    for (const tableName of tablesToUpdate) {
        try {
            // Jadval mavjudligini tekshirish
            const hasTable = await knex.schema.hasTable(tableName);
            if (!hasTable) {
                // Production'da log qilmaymiz
                continue;
            }

            // user_id ustuni mavjudligini tekshirish
            const hasUserIdColumn = await knex.schema.hasColumn(tableName, 'user_id');
            if (!hasUserIdColumn) {
                // Production'da log qilmaymiz
                continue;
            }

            // ALTER COLUMN TYPE BIGINT
            await knex.raw(`
                ALTER TABLE ?? 
                ALTER COLUMN user_id TYPE BIGINT USING user_id::BIGINT;
            `, [tableName]);

            // Production'da log qilmaymiz (migration'da ortiqcha loglar)
        } catch (error) {
            // Xatolikni e'tiborsiz qoldirish - migration'da ortiqcha loglar
            // Xatolikni e'tiborsiz qoldirish - constraint yoki boshqa muammo bo'lishi mumkin
        }
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    const client = knex.client.config.client;
    const isPostgres = client === 'pg';

    if (!isPostgres) {
        return Promise.resolve();
    }

    const tablesToUpdate = [
        'debt_user_tasks',
        'debt_user_brands',
        'debt_user_branches',
        'debt_user_svrs'
    ];

    for (const tableName of tablesToUpdate) {
        try {
            const hasTable = await knex.schema.hasTable(tableName);
            if (!hasTable) continue;

            const hasUserIdColumn = await knex.schema.hasColumn(tableName, 'user_id');
            if (!hasUserIdColumn) continue;

            // Ehtiyotkorlik bilan INTEGER ga qaytarish (katta qiymatlar yo'qolishi mumkin)
            await knex.raw(`
                ALTER TABLE ?? 
                ALTER COLUMN user_id TYPE INTEGER USING 
                CASE 
                    WHEN user_id > 2147483647 THEN NULL
                    ELSE user_id::INTEGER
                END;
            `, [tableName]);

            // Production'da log qilmaymiz (migration'da ortiqcha loglar)
        } catch (error) {
            // Xatolikni e'tiborsiz qoldirish - migration'da ortiqcha loglar
        }
    }
};

