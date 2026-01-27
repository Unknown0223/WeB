// db.js (TO'LIQ FAYL)

const knex = require('knex');
const bcrypt = require('bcrypt');
const { createLogger } = require('./utils/logger.js');
const path = require('path');
const fs = require('fs').promises;

const log = createLogger('DB');
const saltRounds = 10;

// Database config'ni dynamic olish (har safar environment variable'larni qayta o'qish)
function getDbConfig() {
    // Railway.com'da DATABASE_URL mavjud bo'lsa, uni to'g'ridan-to'g'ri ishlatish
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID || !!process.env.RAILWAY_SERVICE_NAME;
    let databaseUrl = process.env.DATABASE_URL;
    const databasePublicUrl = process.env.DATABASE_PUBLIC_URL; // Railway.com'da bu ham mavjud bo'lishi mumkin
    
    // Reference'ni tekshirish (${{Service.Variable}} formatida)
    const isReference = databaseUrl && typeof databaseUrl === 'string' && databaseUrl.includes('${{');
    const hasDatabaseUrl = !!databaseUrl && databaseUrl.trim() !== '';
    const hasDatabasePublicUrl = !!databasePublicUrl && databasePublicUrl.trim() !== '';
    const hasPostgresConfig = !!(process.env.POSTGRES_HOST && process.env.POSTGRES_DB);
    
    // Railway.com'da DATABASE_PUBLIC_URL mavjud bo'lsa, uni ishlatish (agar DATABASE_URL bo'lmasa yoki reference bo'lsa)
    if (isRailway && (!hasDatabaseUrl || isReference) && hasDatabasePublicUrl) {
        // Agar DATABASE_URL reference bo'lsa yoki bo'lmasa, DATABASE_PUBLIC_URL ni ishlatish
        databaseUrl = databasePublicUrl;
        log.debug(`[DB] Using DATABASE_PUBLIC_URL as DATABASE_URL is ${isReference ? 'a reference (not resolved yet)' : 'not set'}`);
    }
    
    // Debug ma'lumotlari (faqat Railway.com'da)
    if (isRailway) {
        log.debug(`[DB] Railway.com environment detected`);
        log.debug(`[DB] DATABASE_URL exists: ${hasDatabaseUrl}`);
        log.debug(`[DB] DATABASE_URL is reference: ${isReference}`);
        log.debug(`[DB] DATABASE_URL value: ${process.env.DATABASE_URL ? (isReference ? 'Reference (will be resolved at runtime)' : (process.env.DATABASE_URL.length > 50 ? process.env.DATABASE_URL.substring(0, 50) + '...' : process.env.DATABASE_URL)) : 'NOT SET'}`);
        log.debug(`[DB] DATABASE_PUBLIC_URL exists: ${hasDatabasePublicUrl}`);
        log.debug(`[DB] Using connection: ${databaseUrl ? (databaseUrl.length > 50 ? databaseUrl.substring(0, 50) + '...' : databaseUrl) : 'NOT SET'}`);
        log.debug(`[DB] POSTGRES_HOST exists: ${!!process.env.POSTGRES_HOST}`);
        log.debug(`[DB] POSTGRES_DB exists: ${!!process.env.POSTGRES_DB}`);
    }
    
    // Railway.com'da va DATABASE_URL mavjud bo'lsa (reference yoki oddiy connection string), PostgreSQL config qaytarish
    // Railway runtime'da reference'lar avtomatik resolve qilinadi
    if (isRailway && databaseUrl) {
        // Avval PGHOST, PGDATABASE, PGUSER, PGPASSWORD ni tekshirish
        // Agar ular mavjud bo'lsa, ularni DATABASE_URL dan ustun qilish
        // (chunki DATABASE_URL ba'zida noto'g'ri parolga ega bo'lishi mumkin)
        const pgHost = process.env.PGHOST;
        const pgPort = process.env.PGPORT || '5432';
        const pgDatabase = process.env.PGDATABASE;
        const pgUser = process.env.PGUSER;
        const pgPassword = process.env.PGPASSWORD;
        
        if (pgHost && pgDatabase && pgUser && pgPassword) {
            // PGHOST, PGDATABASE, PGUSER, PGPASSWORD mavjud bo'lsa, ularni ishlatish
            log.debug(`[DB] Using Railway.com's auto-generated PostgreSQL variables (PGHOST, PGDATABASE, etc.)`);
            log.debug(`[DB] Connection created from PGHOST=${pgHost}, PGDATABASE=${pgDatabase}, PGUSER=${pgUser}`);
            
            return {
                client: 'pg',
                connection: {
                    host: pgHost,
                    port: parseInt(pgPort) || 5432,
                    database: pgDatabase,
                    user: pgUser,
                    password: pgPassword,
                    // Railway ichki tarmog'ida ko'pincha SSL majburiy emas.
                    // SSL handshake muammolarini oldini olish uchun bu yerda SSL'ni majburlamaymiz.
                },
                migrations: {
                    directory: path.resolve(__dirname, 'migrations')
                },
                pool: {
                    min: 1,
                    max: 3,
                    acquireTimeoutMillis: 10000,
                    idleTimeoutMillis: 120000, // 120s - ulanishlarni uzoqroq saqlash, SSL handshake kamayishi
                    createTimeoutMillis: 60000,
                    destroyTimeoutMillis: 5000,
                    reapIntervalMillis: 5000, // 5s - kamroq tekshirish, kamroq overhead
                    createRetryIntervalMillis: 1000, // 1s - retry orasida biroz kutish
                    propagateCreateError: false
                },
                acquireConnectionTimeout: 10000,
                asyncStackTraces: false,
                debug: false
            };
        }
        
        // Agar PGHOST, PGDATABASE, PGUSER, PGPASSWORD bo'lmasa, DATABASE_URL ni ishlatish
        // Reference bo'lsa ham, Railway runtime'da resolve qilinadi
        // Knex.js reference'ni connection string sifatida qabul qiladi va Railway runtime'da resolve qiladi
        
        // Connection string'ni tozalash - yangi qatorlarni olib tashlash
        databaseUrl = databaseUrl.replace(/\s+/g, '').trim();
        
        // Eslatma: Railway Postgres'da SSL'ni majburan yoqish ba'zi holatlarda
        // handshake muammolari keltirib chiqarishi mumkin. Shuning uchun connection string'ga
        // sslmode qo'shmaymiz; kerak bo'lsa pg config orqali boshqariladi.
        const connectionConfig = databaseUrl;
        
        return {
            client: 'pg',
            connection: connectionConfig,
            migrations: {
                directory: path.resolve(__dirname, 'migrations')
            },
            pool: {
                min: 1,
                max: 3,
                acquireTimeoutMillis: 10000,
                idleTimeoutMillis: 120000, // 120s - ulanishlarni uzoqroq saqlash, SSL handshake kamayishi
                createTimeoutMillis: 60000,
                destroyTimeoutMillis: 5000,
                reapIntervalMillis: 5000, // 5s - kamroq tekshirish, kamroq overhead
                createRetryIntervalMillis: 1000, // 1s - retry orasida biroz kutish
                propagateCreateError: false
            },
            acquireConnectionTimeout: 10000,
            asyncStackTraces: false,
            debug: false
        };
    }
    
    // Railway.com'da lekin DATABASE_URL bo'lmasa, Railway.com'ning avtomatik yaratilgan PostgreSQL variable'larini tekshirish
    if (isRailway && !databaseUrl && !hasPostgresConfig) {
        // Railway.com'da Postgres service bilan bog'langan bo'lsa, Railway avtomatik PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD yaratadi
        const pgHost = process.env.PGHOST;
        const pgPort = process.env.PGPORT || '5432';
        const pgDatabase = process.env.PGDATABASE;
        const pgUser = process.env.PGUSER;
        const pgPassword = process.env.PGPASSWORD;
        
        if (pgHost && pgDatabase && pgUser && pgPassword) {
            // Railway.com'ning avtomatik yaratilgan PostgreSQL variable'laridan connection object yaratish
            // Railway.com'da SSL kerak bo'lishi mumkin
            log.debug(`[DB] Using Railway.com's auto-generated PostgreSQL variables (PGHOST, PGDATABASE, etc.)`);
            log.debug(`[DB] Connection created from PGHOST=${pgHost}, PGDATABASE=${pgDatabase}, PGUSER=${pgUser}`);
            
            return {
                client: 'pg',
                connection: {
                    host: pgHost,
                    port: parseInt(pgPort) || 5432,
                    database: pgDatabase,
                    user: pgUser,
                    password: pgPassword,
                    // Railway ichki tarmog'ida ko'pincha SSL majburiy emas.
                    // SSL handshake muammolarini oldini olish uchun bu yerda SSL'ni majburlamaymiz.
                },
                migrations: {
                    directory: path.resolve(__dirname, 'migrations')
                },
                pool: {
                    min: 1,
                    max: 3,
                    acquireTimeoutMillis: 10000,
                    idleTimeoutMillis: 120000, // 120s - ulanishlarni uzoqroq saqlash, SSL handshake kamayishi
                    createTimeoutMillis: 60000,
                    destroyTimeoutMillis: 5000,
                    reapIntervalMillis: 5000, // 5s - kamroq tekshirish, kamroq overhead
                    createRetryIntervalMillis: 1000, // 1s - retry orasida biroz kutish
                    propagateCreateError: false
                },
                acquireConnectionTimeout: 10000,
                asyncStackTraces: false,
                debug: false
            };
        }
        
        // Agar hech qanday PostgreSQL config topilmasa, xatolik chiqarish
        log.error('❌ [DB] ❌ [DB] Railway.com\'da DATABASE_URL sozlanmagan!');
        log.error('❌ [DB] ❌ [DB] Iltimos, Railway.com\'da PostgreSQL service qo\'shing va uni web service bilan bog\'lang.');
        log.error('❌ [DB] ❌ [DB] PostgreSQL service qo\'shilganda, DATABASE_URL avtomatik yaratiladi.');
        log.error(`[DB] Debug: RAILWAY_ENVIRONMENT=${process.env.RAILWAY_ENVIRONMENT || 'NOT SET'}`);
        log.error(`[DB] Debug: RAILWAY_PROJECT_ID=${process.env.RAILWAY_PROJECT_ID || 'NOT SET'}`);
        log.error(`[DB] Debug: RAILWAY_SERVICE_NAME=${process.env.RAILWAY_SERVICE_NAME || 'NOT SET'}`);
        log.error(`[DB] Debug: DATABASE_URL=${process.env.DATABASE_URL || 'NOT SET'}`);
        log.error(`[DB] Debug: DATABASE_PUBLIC_URL=${process.env.DATABASE_PUBLIC_URL || 'NOT SET'}`);
        log.error(`[DB] Debug: PGHOST=${pgHost || 'NOT SET'}`);
        log.error(`[DB] Debug: PGDATABASE=${pgDatabase || 'NOT SET'}`);
        log.error(`[DB] Debug: PGUSER=${pgUser || 'NOT SET'}`);
        log.error(`[DB] Debug: PGPASSWORD=${pgPassword ? 'SET (hidden)' : 'NOT SET'}`);
        
        // Reference bo'lsa, aniqroq xabar
        const rawDatabaseUrl = process.env.DATABASE_URL;
        const isReferenceInEnv = rawDatabaseUrl && rawDatabaseUrl.includes('${{');
        
        if (isReferenceInEnv) {
            throw new Error(
                'Railway.com\'da DATABASE_URL reference resolve qilinmagan!\n' +
                'Muammo: ${{Postgres.DATABASE_URL}} reference start vaqtida resolve qilinmayapti.\n\n' +
                'YECHIM: Reference\'ni to\'g\'ridan-to\'g\'ri connection string bilan almashtirish kerak:\n\n' +
                '1. Railway.com dashboard\'ga kiring\n' +
                '2. Postgres service\'ning Variables bo\'limiga o\'ting\n' +
                '3. DATABASE_PUBLIC_URL yoki DATABASE_URL ning to\'liq qiymatini ko\'ring\n' +
                '   (masalan: postgresql://postgres:password@host:port/database)\n' +
                '4. WeB service\'ning Variables bo\'limiga o\'ting\n' +
                '5. DATABASE_URL ni o\'chiring (agar mavjud bo\'lsa)\n' +
                '6. "+ New Variable" tugmasini bosing\n' +
                '7. Key: DATABASE_URL\n' +
                '8. Value: Postgres service\'dan ko\'chirilgan to\'liq connection string\n' +
                '9. Saqlang va qayta deploy qiling\n\n' +
                'Eslatma: Reference (${{...}}) ba\'zida ishlamaydi. To\'g\'ridan-to\'g\'ri connection string ishlatish tavsiya etiladi.'
            );
        }
        
        throw new Error(
            'Railway.com\'da DATABASE_URL sozlanmagan!\n' +
            'Iltimos, Railway.com\'da PostgreSQL service qo\'shing va uni web service bilan bog\'lang.\n' +
            'PostgreSQL service qo\'shilganda, DATABASE_URL avtomatik yaratiladi.\n\n' +
            'Qo\'llanma:\n' +
            '1. Railway.com dashboard\'ga kiring\n' +
            '2. Postgres service\'ning Variables bo\'limiga o\'ting\n' +
            '3. DATABASE_PUBLIC_URL yoki DATABASE_URL ning to\'liq qiymatini ko\'ring\n' +
            '4. WeB service\'ning Variables bo\'limiga o\'ting\n' +
            '5. "+ New Variable" tugmasini bosing\n' +
            '6. Key: DATABASE_URL\n' +
            '7. Value: Postgres service\'dan ko\'chirilgan to\'liq connection string\n' +
            '8. Saqlang va qayta deploy qiling'
        );
    }
    
    // Boshqa holatda knexfile.js dan config olish
    try {
        const config = require('./knexfile.js');
        const env = process.env.NODE_ENV || 'development';
        return config[env] || config.development;
    } catch (error) {
        // knexfile.js da xatolik bo'lsa (masalan, Railway.com'da DATABASE_URL bo'lmasa)
        // va Railway.com'da bo'lsa, xatolikni qayta chiqarish
        if (isRailway) {
            throw error;
        }
        // Boshqa holatda, xatolikni qayta chiqarish
        throw error;
    }
}

// NODE_ENV ga qarab development yoki production sozlamasini tanlash
const env = process.env.NODE_ENV || 'development';
const dbConfig = getDbConfig();

// Asosiy database connection
const db = knex(dbConfig);

// Database turini aniqlash (avtomatik)
const isPostgres = dbConfig.client === 'pg';
const isSqlite = dbConfig.client === 'sqlite3';

// Yordamchi funksiya: Constraint xatolikni tekshirish
const isConstraintError = (error) => {
    if (!error) return false;
    
    // PostgreSQL xatoliklari
    if (error.code === '23505') return true; // unique_violation
    if (error.code === '23503') return true; // foreign_key_violation
    if (error.code === '23502') return true; // not_null_violation
    
    // SQLite xatoliklari
    if (error.code === 'SQLITE_CONSTRAINT') return true;
    if (error.message && error.message.includes('UNIQUE constraint failed')) return true;
    
    return false;
};

// Yordamchi funksiya: Audit jurnaliga yozish
const logAction = async (userId, action, targetType = null, targetId = null, details = {}) => {
    try {
        const ipAddress = details.ip || null;
        const userAgent = details.userAgent || null;
        if (details.ip) delete details.ip;
        if (details.userAgent) delete details.userAgent;
        
        const logEntry = {
            user_id: userId,
            action: action,
            target_type: targetType,
            target_id: targetId,
            details: JSON.stringify(details),
            ip_address: ipAddress,
            user_agent: userAgent,
        };
        
        // SQLite uchun .returning() ishlamaydi
        let logId;
        if (isSqlite) {
            const insertedIds = await db('audit_logs').insert(logEntry);
            logId = Array.isArray(insertedIds) ? insertedIds[0] : insertedIds;
        } else {
            const result = await db('audit_logs').insert(logEntry).returning('id');
            logId = result[0]?.id || result[0];
        }
        
        // Muhim event'lar uchun WebSocket orqali realtime yuborish
        const importantActions = [
            'create_report', 'edit_report', 'delete_report',
            'create_user', 'edit_user', 'delete_user', 'approve_user', 'reject_user',
            'create_role', 'update_role', 'delete_role',
            'login_success', 'login_fail', 'logout', 'account_lock',
            'change_password', 'change_secret_word'
        ];
        
        if (global.broadcastWebSocket && importantActions.includes(action)) {
            global.broadcastWebSocket('audit_log_added', {
                logId: logId,
                userId: userId,
                action: action,
                targetType: targetType,
                targetId: targetId,
                details: details,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        log.error('Audit log yozishda xatolik:', error.message);
    }
};

const initializeDB = async () => {
    const initStartTime = Date.now();
    log.info('[DB] ═══════════════════════════════════════════════════════════');
    log.info('[DB] 🗄️  DATABASE INITIALIZATION BOSHLANDI');
    log.info(`[DB] 📅 Vaqt: ${new Date().toISOString()}`);
    log.info(`[DB] 🔧 Database Type: ${isPostgres ? 'PostgreSQL' : isSqlite ? 'SQLite' : 'Unknown'}`);
    log.info(`[DB] 🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    const poolCfg = dbConfig.pool || {};
    log.info(`[DB] 📦 Pool: min=${poolCfg.min ?? '?'} max=${poolCfg.max ?? '?'} acquireTimeout=${poolCfg.acquireTimeoutMillis ?? dbConfig.acquireConnectionTimeout ?? '?'}ms`);
    log.info('[DB] ═══════════════════════════════════════════════════════════');
    
    // Migration'larni bajarishdan oldin connection pool'ni tozalash
    // Railway.com'da connection pool to'lib qolmasligi uchun
    log.info('[DB] Connection pool tozalash uchun kutish (1000ms)...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Migration'larni bajarish - connection pool to'lib qolmasligi uchun retry mexanizmi bilan
    let migrationRetries = 5;
    let migrationLastError = null;
    
    log.info(`[DB] Migration bajarish boshlandi (${migrationRetries} ta retry imkoniyati)`);
    
    while (migrationRetries > 0) {
        try {
            // Connection pool'ni test qilish
            log.info('[DB] Connection pool test qilinmoqda...');
            try {
                // Knex ba'zan faqat timeout qaytaradi va asl sababni yashiradi.
                // Shuning uchun avval pg Client bilan tezkor probe qilamiz.
                try {
                    const { Client } = require('pg');
                    const connection = dbConfig?.connection;
                    const probeStart = Date.now();
                    
                    let clientOptions = {};
                    if (typeof connection === 'string') {
                        clientOptions = { connectionString: connection };
                    } else if (connection && typeof connection === 'object') {
                        clientOptions = { ...connection };
                    }
                    
                    const probeClient = new Client({
                        ...clientOptions,
                        connectionTimeoutMillis: 8000
                    });
                    
                    await probeClient.connect();
                    await probeClient.query('SELECT 1');
                    await probeClient.end();
                    const probeMs = Date.now() - probeStart;
                    log.info(`[DB] ✅ PG probe OK (${probeMs}ms)`);
                } catch (probeError) {
                    log.warn(`[DB] ⚠️ PG probe FAIL (${probeError?.code || 'NO_CODE'}): ${probeError?.message || probeError}`);
                }
                
                await db.raw('SELECT 1');
                log.info('[DB] ✅ Connection pool test muvaffaqiyatli');
            } catch (testError) {
                log.warn(`[DB] ⚠️ Connection test xatolik (${testError?.code || 'NO_CODE'}): ${testError?.message || testError}. ${1000}ms kutib qayta urinilmoqda...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                migrationRetries--;
                continue;
            }
            
            log.info('[DB] Migrationlarni bajarish boshlandi...');
            const migrationStartTime = Date.now();
            await db.migrate.latest();
            const migrationDuration = Date.now() - migrationStartTime;
            log.info(`[DB] ✅ Migrationlar muvaffaqiyatli bajarildi (${migrationDuration}ms)`);
            migrationRetries = 0;
            break;
        } catch (migrationError) {
            migrationLastError = migrationError;
            migrationRetries--;
            
            // Connection pool timeout yoki lock xatoliklari uchun retry
            const isRetryableMigrationError = 
                migrationError.message?.includes('Timeout acquiring a connection') ||
                migrationError.message?.includes('pool is probably full') ||
                migrationError.message?.includes('ECONNREFUSED') ||
                migrationError.code === 'ECONNREFUSED';
            
            if (isRetryableMigrationError && migrationRetries > 0) {
                // Exponential backoff - har safar kutish vaqti oshadi
                const delay = Math.min(2000 * (6 - migrationRetries), 10000); // 2s, 4s, 6s, 8s, 10s
                log.warn(`[DB] ⚠️ Migration retryable xatolik, ${delay}ms kutib qayta urinilmoqda... (${migrationRetries} qoldi)`);
                log.warn(`[DB] 📝 Xatolik: ${migrationError.message}`);
                
                // Connection pool'ni tozalash uchun delay
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // Boshqa xatolik yoki retry'lar tugagan
                log.error('[DB] ❌ Migration xatolik:', migrationError.message);
                throw migrationError;
            }
        }
    }
    
    if (migrationLastError && migrationRetries === 0) {
        log.error('[DB] ❌ Migration bajarishda barcha retry urinishlari tugadi');
        throw migrationLastError;
    }
    
    // Migration'lardan keyin connection pool'ni tozalash
    log.info('[DB] Migration\'lardan keyin connection pool tozalash (500ms)...');
    await new Promise(resolve => setTimeout(resolve, 500));

    // --- BOSHLANG'ICH MA'LUMOTLARNI (SEEDS) YARATISH VA YANGILASH ---
    // YANGI LOGIKA: Faqat superadmin standart rol bo'ladi, boshqa rollar superadmin tomonidan yaratiladi

    log.info('[DB] ═══════════════════════════════════════════════════════════');
    log.info('[DB] 🌱 SEEDS (BOSHLANG\'ICH MA\'LUMOTLAR) BOSHLANDI');
    log.info('[DB] ═══════════════════════════════════════════════════════════');
    
    const initialRoles = ['superadmin']; // Faqat superadmin standart rol
    
    const initialPermissions = [
        { permission_key: 'reports:view_all', description: 'Barcha hisobotlarni ko\'rish (Pivot uchun ham)', category: 'Hisobotlar' },
        { permission_key: 'reports:view_assigned', description: 'Biriktirilgan filial hisobotlarini ko\'rish', category: 'Hisobotlar' },
        { permission_key: 'reports:view_own', description: 'Faqat o\'zi yaratgan hisobotlarni ko\'rish', category: 'Hisobotlar' },
        { permission_key: 'reports:create', description: 'Yangi hisobot yaratish', category: 'Hisobotlar' },
        { permission_key: 'reports:edit_all', description: 'Barcha hisobotlarni tahrirlash', category: 'Hisobotlar' },
        { permission_key: 'reports:edit_assigned', description: 'Biriktirilgan filial hisobotlarini tahrirlash', category: 'Hisobotlar' },
        { permission_key: 'reports:edit_own', description: 'Faqat o\'zi yaratgan hisobotlarni tahrirlash', category: 'Hisobotlar' },
        { permission_key: 'reports:delete', description: 'Hisobotlarni o\'chirish', category: 'Hisobotlar' },
        { permission_key: 'users:view', description: 'Foydalanuvchilar ro\'yxatini ko\'rish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:create', description: 'Yangi foydalanuvchi yaratish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:edit', description: 'Foydalanuvchi ma\'lumotlarini (rol, filial) tahrirlash', category: 'Foydalanuvchilar' },
        { permission_key: 'users:change_password', description: 'Foydalanuvchi parolini o\'zgartirish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:set_secret_word', description: 'Foydalanuvchi maxfiy so\'zini o\'rnatish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:change_status', description: 'Foydalanuvchini bloklash/aktivlashtirish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:manage_sessions', description: 'Foydalanuvchi sessiyalarini boshqarish', category: 'Foydalanuvchilar' },
        { permission_key: 'users:connect_telegram', description: 'Foydalanuvchini Telegram botga ulash', category: 'Foydalanuvchilar' },
        { permission_key: 'settings:view', description: 'Sozlamalarni ko\'rish', category: 'Sozlamalar' },
        { permission_key: 'settings:edit_general', description: 'Umumiy sozlamalarni (sahifalash, brending) o\'zgartirish', category: 'Sozlamalar' },
        { permission_key: 'settings:edit_table', description: 'Jadval (ustun, qator, filial) sozlamalarini o\'zgartirish', category: 'Sozlamalar' },
        { permission_key: 'settings:edit_telegram', description: 'Telegram sozlamalarini o\'zgartirish', category: 'Sozlamalar' },
        { permission_key: 'roles:manage', description: 'Rollar va huquqlarni boshqarish', category: 'Rollar' },
        { permission_key: 'dashboard:view', description: 'Boshqaruv panelini (statistika) ko\'rish', category: 'Boshqaruv Paneli' },
        { permission_key: 'audit:view', description: 'Tizim jurnali (audit log)ni ko\'rish', category: 'Admin' },
        // Qiymatlarni Solishtirish permission'lari
        { permission_key: 'comparison:view', description: 'Qiymatlarni solishtirish bo\'limini ko\'rish', category: 'Qiymatlarni Solishtirish' },
        { permission_key: 'comparison:edit', description: 'Solishtirish summalarini kiritish va saqlash', category: 'Qiymatlarni Solishtirish' },
        { permission_key: 'comparison:export', description: 'Solishtirish natijalarini Excel faylga eksport qilish', category: 'Qiymatlarni Solishtirish' },
        { permission_key: 'comparison:notify', description: 'Farqlar haqida operatorlarga bildirishnoma yuborish', category: 'Qiymatlarni Solishtirish' }
    ];

    // Superadmin uchun barcha huquqlar
    const rolePerms = {
        superadmin: initialPermissions.map(p => p.permission_key) // Superadmin barcha huquqlarga ega va cheklovsiz
    };

    // Boshlang'ich ma'lumotlarni kiritish (transaction o'rniga alohida operatsiyalar - connection pool optimallashtirish)
    // Barcha operatsiyalar onConflict.ignore() bilan idempotent, shuning uchun transaction zarur emas
    log.info('[DB] [SEEDS] Roles va permissions yaratish boshlandi...');
    const seedsStartTime = Date.now();
    
    try {
        // Rollarni tekshirish
        const rolesBefore = await db('roles').select('role_name');
        const roleNamesBefore = rolesBefore.map(r => r.role_name);
        log.info(`[DB] [SEEDS] Mavjud rollar: ${roleNamesBefore.length} ta`);
        
        // Faqat superadmin rolini yaratish
        try {
            await db('roles')
                .insert(initialRoles.map(r => ({ role_name: r })))
                .onConflict('role_name')
                .ignore();
            log.info(`[DB] [SEEDS] ✅ Superadmin roli yaratildi/yangilandi`);
        } catch (insertError) {
            if (!isConstraintError(insertError)) {
                throw insertError;
            }
        }
        
        // Connection pool to'lib qolmasligi uchun delay
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Permissions yaratish - oldindan tekshirib, faqat yangilarini insert qilish (connection pool optimallashtirish)
        log.info(`[DB] [SEEDS] ${initialPermissions.length} ta permission tekshirilmoqda...`);
        const existingPermissions = await db('permissions').select('permission_key');
        const existingKeys = new Set(existingPermissions.map(p => p.permission_key));
        const newPermissions = initialPermissions.filter(perm => !existingKeys.has(perm.permission_key));
        
        if (newPermissions.length > 0) {
            log.info(`[DB] [SEEDS] ${newPermissions.length} ta yangi permission yaratilmoqda...`);
            // Kichik chunk'larga bo'lib insert qilish (connection pool optimallashtirish)
            const chunkSize = 3; // Har safar 3 ta permission insert qilish
            for (let i = 0; i < newPermissions.length; i += chunkSize) {
                const chunk = newPermissions.slice(i, i + chunkSize);
                try {
                    await db('permissions').insert(chunk);
                    log.debug(`[DB] [SEEDS] ${chunk.length} ta permission insert qilindi (${i + 1}-${Math.min(i + chunkSize, newPermissions.length)}/${newPermissions.length})`);
                } catch (chunkError) {
                    // Agar chunk insert xatolik bersa, har birini alohida qo'shish
                    log.warn(`[DB] [SEEDS] ⚠️ Chunk insert xatolik, alohida insert qilinmoqda: ${chunkError.message}`);
                    for (const perm of chunk) {
                        try {
                            await db('permissions')
                                .insert(perm)
                                .onConflict('permission_key')
                                .ignore();
                        } catch (individualError) {
                            // Individual insert xatolik - e'tiborsiz qoldirish (onConflict.ignore() bilan idempotent)
                            log.debug(`[DB] [SEEDS] Permission ${perm.permission_key} insert xatolik (e'tiborsiz): ${individualError.message}`);
                        }
                        // Har bir permission'dan keyin delay (connection pool bo'shatish uchun)
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
                // Har bir chunk'dan keyin delay (connection pool bo'shatish uchun)
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            log.info(`[DB] [SEEDS] ✅ ${newPermissions.length} ta yangi permission yaratildi`);
        } else {
            log.info(`[DB] [SEEDS] ✅ Barcha permissions allaqachon mavjud`);
        }
        
        // Connection pool to'lib qolmasligi uchun delay
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Superadmin uchun barcha huquqlarni biriktirish - kichik chunk'larga bo'lib (connection pool optimallashtirish)
        log.info(`[DB] [SEEDS] Superadmin uchun ${rolePerms.superadmin.length} ta permission biriktirilmoqda...`);
        await db('role_permissions').where({ role_name: 'superadmin' }).del();
        const permsToInsert = rolePerms.superadmin.map(pKey => ({
            role_name: 'superadmin',
            permission_key: pKey
        }));
        if (permsToInsert.length > 0) {
            const chunkSize = 5; // Har safar 5 ta role_permission insert qilish (kichikroq chunk)
            for (let i = 0; i < permsToInsert.length; i += chunkSize) {
                const chunk = permsToInsert.slice(i, i + chunkSize);
                try {
                    await db('role_permissions').insert(chunk);
                    log.debug(`[DB] [SEEDS] ${chunk.length} ta role_permission insert qilindi (${i + 1}-${Math.min(i + chunkSize, permsToInsert.length)}/${permsToInsert.length})`);
                } catch (chunkError) {
                    // Agar chunk insert xatolik bersa, har birini alohida qo'shish
                    log.warn(`[DB] [SEEDS] ⚠️ Role permission chunk insert xatolik, alohida insert qilinmoqda: ${chunkError.message}`);
                    for (const perm of chunk) {
                        try {
                            await db('role_permissions').insert(perm).onConflict(['role_name', 'permission_key']).ignore();
                        } catch (individualError) {
                            log.debug(`[DB] [SEEDS] Role permission insert xatolik (e'tiborsiz): ${individualError.message}`);
                        }
                        // Har bir permission'dan keyin delay (connection pool bo'shatish uchun)
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
                // Har bir chunk'dan keyin delay (connection pool bo'shatish uchun)
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        log.info(`[DB] [SEEDS] ✅ Superadmin permissions biriktirildi`);
        
        // Connection pool to'lib qolmasligi uchun delay
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // "menejer" roliga default "debt:create" permission qo'shish
        const menejerRoleExists = await db('roles').where('role_name', 'menejer').first();
        if (menejerRoleExists) {
            const debtCreatePermission = await db('permissions').where('permission_key', 'debt:create').first();
            if (debtCreatePermission) {
                const existingMenejerDebtCreate = await db('role_permissions')
                    .where({ role_name: 'menejer', permission_key: 'debt:create' })
                    .first();
                
                if (!existingMenejerDebtCreate) {
                    try {
                        await db('role_permissions').insert({
                            role_name: 'menejer',
                            permission_key: 'debt:create'
                        });
                        log.info(`[DB] [SEEDS] ✅ "menejer" roliga "debt:create" permission qo'shildi`);
                    } catch (error) {
                        log.debug(`[DB] [SEEDS] "menejer" roliga "debt:create" permission qo'shishda xatolik (e'tiborsiz): ${error.message}`);
                    }
                } else {
                    log.debug(`[DB] [SEEDS] "menejer" roliga "debt:create" permission allaqachon mavjud`);
                }
            }
        }
        
        // Superadmin uchun shartlar null (cheksiz dostup)
        await db('roles')
            .where('role_name', 'superadmin')
            .update({ requires_locations: null, requires_brands: null });
        log.info(`[DB] [SEEDS] ✅ Superadmin sozlamalari yangilandi`);
        
        // Rollarni tekshirish
        const rolesAfter = await db('roles').select('role_name');
        const roleNamesAfter = rolesAfter.map(r => r.role_name);
        
        // Yo'qolgan rollarni topish
        const lostRoles = roleNamesBefore.filter(role => !roleNamesAfter.includes(role));
        if (lostRoles.length > 0) {
            log.error(`[DB] [SEEDS] ❌ XATOLIK: Quyidagi rollar yo'qoldi (${lostRoles.length} ta):`, lostRoles);
        }
        
        const seedsDuration = Date.now() - seedsStartTime;
        log.info(`[DB] [SEEDS] ✅ Roles va permissions muvaffaqiyatli yaratildi (${seedsDuration}ms)`);
    } catch (error) {
        // Connection pool timeout yoki lock xatoliklari uchun retry
        const isRetryableError = 
            error.message?.includes('Timeout acquiring a connection') ||
            error.message?.includes('pool is probably full') ||
            error.code === '23505' ||
            error.code === 'SQLITE_BUSY';
        
        if (isRetryableError) {
            log.warn(`[DB] [SEEDS] ⚠️ Retryable xatolik: ${error.message}`);
            log.warn(`[DB] [SEEDS] ⚠️ Seeds operatsiyalari idempotent, shuning uchun xatolik e'tiborsiz qoldirilmoqda`);
        } else {
            log.error(`[DB] [SEEDS] ❌ Xatolik: ${error.message}`);
            throw error;
        }
    }

    // Seeds faylini ishga tushirish (kengaytirilgan permission'lar)
    log.info('[DB] [SEEDS] Kengaytirilgan permissions seed fayli ishga tushirilmoqda...');
    const expandedSeedStartTime = Date.now();
    // Connection pool to'lib qolmasligi uchun delay qo'shish
    try {
        await new Promise(resolve => setTimeout(resolve, 200));
        const expandedPermissionsSeed = require('./seeds/02_expanded_permissions.js');
        await expandedPermissionsSeed.seed(db);
        await new Promise(resolve => setTimeout(resolve, 200));
        const expandedSeedDuration = Date.now() - expandedSeedStartTime;
        log.info(`[DB] [SEEDS] ✅ Kengaytirilgan permissions seed muvaffaqiyatli bajarildi (${expandedSeedDuration}ms)`);
    } catch (error) {
        log.warn(`[DB] [SEEDS] ⚠️ Seeds faylini ishga tushirishda xatolik: ${error.message}`);
        // Xatolik bo'lsa ham davom etamiz
    }

    // Connection pool to'lib qolmasligi uchun delay
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Superadmin yaratish (agar mavjud bo'lmasa)
    log.info('[DB] [SEEDS] Superadmin foydalanuvchi tekshirilmoqda...');
    const superadminStartTime = Date.now();
    // Eski super_admin va yangi superadmin ni tekshirish
    const superAdminUser = await db('users').whereIn('role', ['super_admin', 'superadmin']).first();
    if (!superAdminUser) {
        log.info('[DB] [SEEDS] Superadmin foydalanuvchi topilmadi, yaratilmoqda...');
        const hashedPassword = await bcrypt.hash('superadmin123', saltRounds);
        await db('users').insert({ 
            username: 'superadmin', 
            password: hashedPassword, 
            role: 'superadmin',
            status: 'active',
            device_limit: 999 // Superadmin uchun cheksiz device limit
        });
        const superadminDuration = Date.now() - superadminStartTime;
        log.info(`[DB] [SEEDS] ✅ Superadmin foydalanuvchi yaratildi (${superadminDuration}ms)`);
    } else if (superAdminUser.role === 'super_admin') {
        // Eski super_admin ni superadmin ga o'zgartirish
        log.info('[DB] [SEEDS] Eski super_admin roli yangilanmoqda...');
        await db('users').where({ id: superAdminUser.id }).update({ role: 'superadmin' });
        const superadminDuration = Date.now() - superadminStartTime;
        log.info(`[DB] [SEEDS] ✅ Eski super_admin roli superadmin ga o'zgartirildi (${superadminDuration}ms)`);
    } else {
        const superadminDuration = Date.now() - superadminStartTime;
        log.info(`[DB] [SEEDS] ✅ Superadmin foydalanuvchi mavjud (${superadminDuration}ms)`);
    }
    
    // Telegram sozlamalarini tekshirish va qo'yish (agar mavjud bo'lmasa)
    log.info('[DB] [SEEDS] Telegram sozlamalari tekshirilmoqda...');
    const telegramSettingsStartTime = Date.now();
    // Faqat mavjud bo'lmaganda bo'sh yaratish, avtomatik to'ldirmaslik
    const telegramSettings = [
        { key: 'telegram_bot_token', value: '' },
        { key: 'telegram_bot_username', value: '' },
        { key: 'telegram_admin_chat_id', value: '' },
        { key: 'telegram_group_id', value: '' },
        { key: 'telegram_enabled', value: 'false' } // Telegram aktiv/neaktiv holati
    ];
    
    // OPTIMALLASHTIRISH: Barcha mavjud setting'larni bitta query bilan olish (connection pool optimallashtirish)
    const settingKeys = telegramSettings.map(s => s.key);
    const existingSettings = await db('settings').whereIn('key', settingKeys).select('key');
    const existingKeys = new Set(existingSettings.map(s => s.key));
    
    // Faqat mavjud bo'lmaganlarini insert qilish
    const settingsToInsert = telegramSettings.filter(s => !existingKeys.has(s.key));
    
    if (settingsToInsert.length > 0) {
        try {
            // Bitta batch insert (connection pool optimallashtirish)
            await db('settings').insert(settingsToInsert);
            const telegramSettingsDuration = Date.now() - telegramSettingsStartTime;
            log.info(`[DB] [SEEDS] ✅ Telegram sozlamalari qo'shildi: ${settingsToInsert.length} ta (${telegramSettingsDuration}ms)`);
        } catch (insertError) {
            log.warn(`[DB] [SEEDS] ⚠️ Batch settings insert xatolik: ${insertError.message}`);
            // Retry mexanizmi - har birini alohida qo'shish (connection pool to'lib qolmasligi uchun delay bilan)
            for (const setting of settingsToInsert) {
                try {
                    await db('settings').insert(setting).onConflict('key').ignore();
                } catch (individualError) {
                    log.warn(`[DB] [SEEDS] ⚠️ Setting insert xatolik (${setting.key}): ${individualError.message}`);
                }
                // Connection pool to'lib qolmasligi uchun delay
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    } else {
        const telegramSettingsDuration = Date.now() - telegramSettingsStartTime;
        log.info(`[DB] [SEEDS] ✅ Barcha telegram sozlamalari mavjud (${telegramSettingsDuration}ms)`);
    }
    
    const totalSeedsDuration = Date.now() - seedsStartTime;
    const totalInitDuration = Date.now() - initStartTime;
    log.info('[DB] ═══════════════════════════════════════════════════════════');
    log.info(`[DB] ✅ DATABASE INITIALIZATION MUVAFFAQIYATLI TUGADI`);
    log.info(`[DB] ⏱️  Seeds vaqt: ${totalSeedsDuration}ms`);
    log.info(`[DB] ⏱️  Jami vaqt: ${totalInitDuration}ms`);
    log.info('[DB] ═══════════════════════════════════════════════════════════');
};

// Connection string olish (session store uchun)
function getDbConnectionString() {
    const config = getDbConfig();
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID || !!process.env.RAILWAY_SERVICE_NAME;
    
    if (config.connection && typeof config.connection === 'string') {
        // Connection string bo'lsa, SSL parametrlarini qo'shish (Railway.com uchun)
        let connectionString = config.connection;
        
        // SSL mode'ni majburan qo'shmaymiz (Railway'da SSL handshake muammolari bo'lishi mumkin)
        
        return connectionString;
    } else if (config.connection && typeof config.connection === 'object') {
        const conn = config.connection;
        let connectionString = `postgresql://${conn.user}:${conn.password}@${conn.host}:${conn.port}/${conn.database}`;
        
        // SSL parametrlarini qo'shmaymiz (zarur bo'lsa session store pg Pool orqali boshqariladi)
        
        return connectionString;
    }
    return null;
}

module.exports = { db, initializeDB, logAction, isPostgres, isSqlite, isConstraintError, getDbConnectionString };
