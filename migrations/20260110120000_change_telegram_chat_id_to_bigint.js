/**
 * Migration: telegram_chat_id ni INTEGER dan BIGINT ga o'zgartirish
 * Sabab: Telegram chat ID'lari ko'pincha INTEGER maksimalidan katta (masalan, 7048657605)
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    const client = knex.client.config.client;
    const isPostgres = client === 'pg';

    if (isPostgres) {
        // PostgreSQL'da ALTER COLUMN ishlatish
        await knex.raw(`
            ALTER TABLE users 
            ALTER COLUMN telegram_chat_id TYPE BIGINT USING telegram_chat_id::BIGINT;
        `);
    } else {
        // SQLite'da ALTER TABLE DROP COLUMN yo'q, shuning uchun jadval qayta yaratamiz
        // (Lekin endi faqat PostgreSQL ishlaydi, shuning uchun bu qism kerak emas)
        return Promise.resolve();
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    const client = knex.client.config.client;
    const isPostgres = client === 'pg';

    if (isPostgres) {
        // Ehtiyotkorlik bilan INTEGER ga qaytarish (katta qiymatlar yo'qolishi mumkin)
        await knex.raw(`
            ALTER TABLE users 
            ALTER COLUMN telegram_chat_id TYPE INTEGER USING 
            CASE 
                WHEN telegram_chat_id > 2147483647 THEN NULL
                ELSE telegram_chat_id::INTEGER
            END;
        `);
    } else {
        return Promise.resolve();
    }
};

