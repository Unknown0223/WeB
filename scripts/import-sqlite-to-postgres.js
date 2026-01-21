#!/usr/bin/env node

/**
 * SQLite'dan PostgreSQL'ga ma'lumotlarni import qilish script'i
 * 
 * Usage:
 *   node scripts/import-sqlite-to-postgres.js [sqlite_db_path]
 * 
 * Environment variables:
 *   DB_TYPE=postgres (yoki .env faylida)
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DATABASE, POSTGRES_USER, POSTGRES_PASSWORD
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config();

const knex = require('knex');
const { createLogger } = require('../utils/logger.js');

const log = createLogger('IMPORT');

// SQLite database fayl yoli
const sqliteDbPath = process.argv[2] || path.resolve(__dirname, '../database.db');

// PostgreSQL connection sozlamalari
const postgresConfig = {
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DATABASE || 'hisobot_tizimi',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
  }
};

// SQLite connection sozlamalari
const sqliteConfig = {
  client: 'sqlite3',
  connection: {
    filename: sqliteDbPath
  },
  useNullAsDefault: true
};

// Jadvallar import tartibi (foreign key dependency'ga qarab)
// O'z-o'ziga bog'liq jadvallar birinchi, keyingi jadvallar keyin
const TABLE_ORDER = [
  // Asosiy jadvallar (foreign key yo'q)
  'roles',
  'permissions',
  'brands',
  'branches',
  'products',
  
  // Debt approval asosiy jadvallar
  'debt_brands',
  'debt_branches',
  'debt_svrs',
  
  // Bog'liq jadvallar
  'role_permissions',
  'users',
  'user_locations',
  'user_permissions',
  'user_settings',
  
  // Debt approval users
  'debt_managers',
  'debt_leaders',
  'debt_cashiers',
  'debt_operators',
  'debt_user_brands',
  'debt_user_branches',
  'debt_user_tasks',
  
  // Reports va boshqa
  'reports',
  'report_history',
  'settings',
  'pivot_templates',
  'magic_links',
  'audit_logs',
  
  // Debt approval requests
  'debt_requests',
  'debt_accepted_data',
  'debt_request_approvals',
  'debt_request_logs',
  'debt_approvals',
  'debt_reminders',
  'debt_blocked_items',
  'debt_requests_archive',
  
  // Boshqa jadvallar
  'sales',
  'stocks',
  'comparisons',
  'exchange_rates',
  'notifications',
  'imports_log',
  'ostatki_analysis',
  'ostatki_imports'
];

// Batch size (bir vaqtda nechta row import qilish)
const BATCH_SIZE = 1000;

/**
 * Progress indicator
 */
function showProgress(current, total, tableName) {
  const percent = Math.round((current / total) * 100);
  const barLength = 30;
  const filled = Math.round((percent / 100) * barLength);
  const bar = '='.repeat(filled) + '-'.repeat(barLength - filled);
  process.stdout.write(`\r[${bar}] ${percent}% - ${tableName}: ${current}/${total}`);
  if (current === total) {
    process.stdout.write('\n');
  }
}

/**
 * PostgreSQL jadvalining primary key ustunlarini olish
 */
async function getPrimaryKeys(postgresDb, tableName) {
  try {
    const result = await postgresDb.raw(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
        AND i.indisprimary
      ORDER BY a.attnum
    `, [tableName]);
    return result.rows.map(row => row.attname);
  } catch (error) {
    log.debug(`Primary key'ni aniqlashda xatolik ${tableName}:`, error.message);
    return [];
  }
}

/**
 * PostgreSQL jadvalining sequence nomini olish (auto-increment uchun)
 */
async function getSequenceName(postgresDb, tableName, columnName = 'id') {
  try {
    const result = await postgresDb.raw(`
      SELECT pg_get_serial_sequence($1, $2) as sequence_name
    `, [tableName, columnName]);
    const seqName = result.rows[0]?.sequence_name;
    return seqName ? seqName.split('.').pop() : null; // schema.sequence_name -> sequence_name
  } catch (error) {
    return null;
  }
}

/**
 * SQLite datetime/timestamp ni PostgreSQL timestamp formatiga o'girish
 */
function convertTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    // Agar Unix timestamp (milliseconds) bo'lsa
    if (/^\d+$/.test(value) && value.length > 10) {
      const timestamp = parseInt(value, 10);
      return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
    }
    // Agar ISO format yoki boshqa format bo'lsa
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toISOString().replace('T', ' ').slice(0, 19);
      }
    } catch (e) {
      // Ignore
    }
  } else if (typeof value === 'number') {
    // Unix timestamp (milliseconds)
    return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
  }
  return value;
}

/**
 * Row'dagi timestamp ustunlarini konvertatsiya qilish
 */
function convertRowTimestamps(row, tableName) {
  const convertedRow = { ...row };
  // Timestamp ustunlarini aniqlash (created_at, updated_at, timestamp, expires_at, etc.)
  const timestampColumns = Object.keys(convertedRow).filter(key => 
    key.includes('_at') || key.includes('_time') || key === 'timestamp' || key === 'expires_at' || key === 'archived_at'
  );
  
  for (const col of timestampColumns) {
    if (convertedRow[col] !== null && convertedRow[col] !== undefined) {
      convertedRow[col] = convertTimestamp(convertedRow[col]);
    }
  }
  
  return convertedRow;
}

/**
 * SQLite'dan PostgreSQL'ga jadval import qilish
 */
async function importTable(sqliteDb, postgresDb, tableName) {
  try {
    // knex_migrations jadvalini skip qilish
    if (tableName === 'knex_migrations' || tableName === 'knex_migrations_lock') {
      log.debug(`Jadval ${tableName} import qilinmaydi (Knex tracking jadvali)`);
      return { imported: 0, skipped: true };
    }

    // Jadval mavjudligini tekshirish
    const sqliteHasTable = await sqliteDb.schema.hasTable(tableName);
    if (!sqliteHasTable) {
      log.debug(`Jadval ${tableName} SQLite'da mavjud emas, o'tkazib yuborildi`);
      return { imported: 0, skipped: true };
    }

    const postgresHasTable = await postgresDb.schema.hasTable(tableName);
    if (!postgresHasTable) {
      log.warn(`Jadval ${tableName} PostgreSQL'da mavjud emas, o'tkazib yuborildi`);
      return { imported: 0, skipped: true };
    }

    // Primary key'ni aniqlash
    const primaryKeys = await getPrimaryKeys(postgresDb, tableName);
    const hasAutoIncrement = primaryKeys.includes('id') && primaryKeys.length === 1;

    // SQLite'dan ma'lumotlarni olish
    const rows = await sqliteDb(tableName).select('*');
    
    // Timestamp'larni konvertatsiya qilish
    const convertedRows = rows.map(row => convertRowTimestamps(row, tableName));
    
    if (convertedRows.length === 0) {
      log.debug(`Jadval ${tableName} bo'sh, o'tkazib yuborildi`);
      return { imported: 0, skipped: true };
    }

    log.info(`Jadval ${tableName} import qilinmoqda: ${convertedRows.length} ta row`);

    // PostgreSQL'da jadvalni tozalash (agar kerak bo'lsa)
    // Ehtiyotkorlik: Bu barcha ma'lumotlarni o'chiradi!
    // await postgresDb(tableName).del();

    // Batch'lar bilan import qilish
    let imported = 0;
    let skipped = 0;
    for (let i = 0; i < convertedRows.length; i += BATCH_SIZE) {
      const batch = convertedRows.slice(i, i + BATCH_SIZE);
      
      try {
        await postgresDb(tableName).insert(batch);
        imported += batch.length;
        showProgress(imported + skipped, convertedRows.length, tableName);
      } catch (error) {
        // Agar duplicate key error bo'lsa, bitta-bitta import qilish
        if (error.code === '23505' || error.message.includes('UNIQUE constraint')) {
          log.warn(`Duplicate key error ${tableName} da, bitta-bitta import qilinmoqda...`);
          for (const row of batch) {
            try {
              // Primary key'ga qarab onConflict ishlatish
              if (primaryKeys.length > 0) {
                if (primaryKeys.length === 1) {
                  // Bitta primary key
                  await postgresDb(tableName)
                    .insert(row)
                    .onConflict(primaryKeys[0])
                    .ignore();
                } else {
                  // Composite primary key
                  await postgresDb(tableName)
                    .insert(row)
                    .onConflict(primaryKeys)
                    .ignore();
                }
                imported++;
              } else {
                // Primary key yo'q, oddiy insert
                await postgresDb(tableName).insert(row);
                imported++;
              }
              showProgress(imported + skipped, convertedRows.length, tableName);
            } catch (singleError) {
              // Foreign key constraint xatoliklarini skip qilish
              if (singleError.code === '23503' || singleError.message.includes('foreign key constraint')) {
                skipped++;
              } else if (singleError.code === '23505' || singleError.message.includes('UNIQUE constraint')) {
                skipped++;
              } else {
                log.error(`Row import xatolik ${tableName}:`, singleError.message);
                skipped++;
              }
              showProgress(imported + skipped, convertedRows.length, tableName);
            }
          }
        } else {
          throw error;
        }
      }
    }

    log.info(`✅ Jadval ${tableName} muvaffaqiyatli import qilindi: ${imported}/${convertedRows.length} ta row${skipped > 0 ? ` (${skipped} ta skip qilindi)` : ''}`);

    // Sequence'larni yangilash (auto-increment uchun)
    if (imported > 0 && hasAutoIncrement) {
      try {
        const sequenceName = await getSequenceName(postgresDb, tableName, 'id');
        if (sequenceName) {
          const maxIdResult = await postgresDb(tableName).max('id as max_id').first();
          if (maxIdResult && maxIdResult.max_id !== null && maxIdResult.max_id !== undefined) {
            await postgresDb.raw(`SELECT setval('${sequenceName}', ${maxIdResult.max_id}, true)`);
            log.debug(`Sequence ${sequenceName} yangilandi: ${maxIdResult.max_id}`);
          }
        }
      } catch (seqError) {
        // Sequence xatolik e'tiborsiz qoldiriladi (ba'zi jadvallarda sequence yo'q)
        log.debug(`Sequence yangilash ${tableName} da xatolik (ehtimol sequence yo'q):`, seqError.message);
      }
    }

    return { imported, skipped: false };
  } catch (error) {
    log.error(`Xatolik ${tableName} import qilishda:`, error);
    throw error;
  }
}

/**
 * Asosiy import funksiyasi
 */
async function importData() {
  let sqliteDb = null;
  let postgresDb = null;

  try {
    log.info('='.repeat(60));
    log.info('SQLite\'dan PostgreSQL\'ga import qilish boshlanmoqda...');
    log.info('='.repeat(60));

    // SQLite database faylini tekshirish
    if (!fs.existsSync(sqliteDbPath)) {
      throw new Error(`SQLite database fayli topilmadi: ${sqliteDbPath}`);
    }
    log.info(`SQLite database: ${sqliteDbPath}`);

    // Connection'larni ochish
    log.info('Connection\'lar ochilmoqda...');
    sqliteDb = knex(sqliteConfig);
    postgresDb = knex(postgresConfig);

    // PostgreSQL connection'ni test qilish
    await postgresDb.raw('SELECT 1');
    log.info('✅ PostgreSQL connection muvaffaqiyatli');

    // SQLite connection'ni test qilish
    await sqliteDb.raw('SELECT 1');
    log.info('✅ SQLite connection muvaffaqiyatli');

    // PostgreSQL'da mavjud jadvallarni olish
    const postgresTables = await postgresDb.raw(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const availableTables = postgresTables.rows.map(row => row.table_name);
    
    log.info(`PostgreSQL'da ${availableTables.length} ta jadval mavjud`);

    // SQLite'dan mavjud jadvallarni olish
    const sqliteTablesResult = await sqliteDb.raw(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);
    // SQLite raw query result format: result is an array, each element has rows
    let sqliteTableNames = [];
    if (Array.isArray(sqliteTablesResult)) {
      // Eski format: array of arrays
      if (sqliteTablesResult.length > 0 && Array.isArray(sqliteTablesResult[0])) {
        sqliteTableNames = sqliteTablesResult[0].map(row => row.name);
      } else {
        // Yangi format: array of objects
        sqliteTableNames = sqliteTablesResult.map(row => row.name);
      }
    } else if (sqliteTablesResult && sqliteTablesResult[0]) {
      sqliteTableNames = sqliteTablesResult[0].map(row => row.name);
    }
    
    log.info(`SQLite'da ${sqliteTableNames.length} ta jadval mavjud`);

    // Import qilinadigan jadvallarni aniqlash
    const tablesToImport = TABLE_ORDER.filter(table => 
      availableTables.includes(table) && sqliteTableNames.includes(table)
    );

    // TABLE_ORDER'da yo'q jadvallarni qo'shish (knex_migrations'dan tashqari)
    const otherTables = sqliteTableNames.filter(table => 
      !TABLE_ORDER.includes(table) && 
      availableTables.includes(table) &&
      table !== 'knex_migrations' &&
      table !== 'knex_migrations_lock'
    );
    tablesToImport.push(...otherTables);

    log.info(`\n${tablesToImport.length} ta jadval import qilinadi:\n${tablesToImport.join(', ')}\n`);

    // Har bir jadvalni import qilish
    const results = [];
    let totalImported = 0;

    for (const tableName of tablesToImport) {
      try {
        const result = await importTable(sqliteDb, postgresDb, tableName);
        results.push({ table: tableName, ...result });
        if (!result.skipped) {
          totalImported += result.imported;
        }
      } catch (error) {
        log.error(`Jadval ${tableName} import qilishda xatolik:`, error);
        results.push({ table: tableName, error: error.message, imported: 0 });
      }
    }

    // Natijalarni ko'rsatish
    log.info('\n' + '='.repeat(60));
    log.info('Import natijalari:');
    log.info('='.repeat(60));
    
    results.forEach(result => {
      if (result.skipped) {
        log.info(`  ${result.table}: o'tkazib yuborildi`);
      } else if (result.error) {
        log.error(`  ${result.table}: XATOLIK - ${result.error}`);
      } else {
        log.info(`  ${result.table}: ${result.imported} ta row`);
      }
    });

    log.info('\n' + '='.repeat(60));
    log.info(`Jami ${totalImported} ta row import qilindi`);
    log.info('='.repeat(60));
    log.info('✅ Import muvaffaqiyatli yakunlandi!');

  } catch (error) {
    log.error('Import jarayonida xatolik:', error);
    process.exit(1);
  } finally {
    // Connection'larni yopish
    if (sqliteDb) {
      await sqliteDb.destroy();
      log.info('SQLite connection yopildi');
    }
    if (postgresDb) {
      await postgresDb.destroy();
      log.info('PostgreSQL connection yopildi');
    }
  }
}

// Script'ni ishga tushirish
if (require.main === module) {
  importData()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      log.error('Fatal xatolik:', error);
      process.exit(1);
    });
}

module.exports = { importData };

