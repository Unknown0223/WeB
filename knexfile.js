// knexfile.js

require('dotenv').config(); // .env faylini yuklash (migration'lar uchun)

const path = require('path');

// Database type ni aniqlash - SQLite yoki PostgreSQL
// Railway.com, Render.com, Heroku kabi platformalarda PostgreSQL majburiy
const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID || !!process.env.RAILWAY_SERVICE_NAME;
const isRender = !!process.env.RENDER;
const isHeroku = !!process.env.HEROKU_APP_NAME;
const isCloudPlatform = isRailway || isRender || isHeroku;

// Railway.com'da DATABASE_URL avtomatik yaratiladi (service qo'shilganda)
// Build vaqtida bo'lmasa ham, start vaqtida bo'ladi
const hasDatabaseUrl = !!process.env.DATABASE_URL;
const hasPostgresConfig = !!(process.env.POSTGRES_HOST && process.env.POSTGRES_DB);

// Cloud platformalarda PostgreSQL majburiy, aks holda SQLite
// Railway.com'da DATABASE_URL bo'lmasa ham, PostgreSQL ishlatish kerak (service qo'shilganda)
const useSqlite = !isCloudPlatform && (process.env.DB_TYPE === 'sqlite' || (!hasPostgresConfig && !hasDatabaseUrl));

if (useSqlite) {
  // SQLite konfiguratsiyasi (Development)
  module.exports = {
    development: {
      client: 'sqlite3',
      connection: {
        filename: path.resolve(__dirname, 'database.db'),
        busyTimeout: 5000,
      },
      useNullAsDefault: true,
      migrations: {
        directory: path.resolve(__dirname, 'migrations')
      },
      pool: {
        afterCreate: (conn, cb) => {
          conn.run('PRAGMA journal_mode = WAL;', (err) => {
            if (err) console.warn('⚠️ WAL mode xatolik:', err.message);
            conn.run('PRAGMA busy_timeout = 5000;', (err2) => {
              cb(err || err2, conn);
            });
          });
        },
        min: 2,
        max: 10,
        acquireTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
      },
      acquireConnectionTimeout: 10000,
    },
    production: {
      client: 'sqlite3',
      connection: {
        filename: path.resolve(__dirname, 'database.db'),
        busyTimeout: 5000
      },
      useNullAsDefault: true,
      migrations: {
        directory: path.resolve(__dirname, 'migrations')
      },
      pool: {
        afterCreate: (conn, cb) => {
          conn.run('PRAGMA journal_mode = WAL;', () => {
            conn.run('PRAGMA busy_timeout = 5000;', () => {
              cb(null, conn);
            });
          });
        },
        min: 5,
        max: 20,
        acquireTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
      },
      acquireConnectionTimeout: 15000,
    }
  };
} else {
  // PostgreSQL konfiguratsiyasi (Production)
  function getPostgresConnection() {
    // DATABASE_URL tekshirish
    if (process.env.DATABASE_URL) {
      return process.env.DATABASE_URL;
    }
    
    // Alohida parametrlar tekshirish
    if (process.env.POSTGRES_HOST && process.env.POSTGRES_DB) {
      const user = process.env.POSTGRES_USER || 'postgres';
      const password = process.env.POSTGRES_PASSWORD || '';
      const host = process.env.POSTGRES_HOST || 'localhost';
      const port = process.env.POSTGRES_PORT || 5432;
      const database = process.env.POSTGRES_DB;
      
      return {
        host: host,
        port: parseInt(port),
        database: database,
        user: user,
        password: password
      };
    }
    
    return null;
  }

  const postgresConfig = getPostgresConnection();

  // Railway.com'da build vaqtida DATABASE_URL bo'lmasa, migration'ni o'tkazib yuborish
  // Start vaqtida DATABASE_URL mavjud bo'ladi (db.js da initializeDB() chaqiriladi)
  if (!postgresConfig) {
    // Railway.com'da build vaqtida DATABASE_URL bo'lmasa, dummy config qaytarish
    // Start vaqtida to'g'ri config bo'ladi (DATABASE_URL mavjud bo'ladi)
    if (isRailway && !hasDatabaseUrl && !hasPostgresConfig) {
      // Build vaqtida migration o'tkazib yuboriladi, start vaqtida to'g'ri config bo'ladi
      // db.js da initializeDB() chaqirilganda, DATABASE_URL allaqachon mavjud bo'ladi
      console.warn('⚠️ [KNEXFILE] Railway.com\'da DATABASE_URL hali sozlanmagan. Migration start vaqtida ishlaydi (db.js orqali).');
      // Dummy config - build vaqtida migration o'tkazib yuboriladi
      // Start vaqtida DATABASE_URL mavjud bo'ladi va to'g'ri config ishlatiladi
      module.exports = {
        development: {
          client: 'pg',
          connection: 'postgresql://dummy:dummy@localhost:5432/dummy',
          migrations: {
            directory: path.resolve(__dirname, 'migrations')
          }
        },
        production: {
          client: 'pg',
          connection: 'postgresql://dummy:dummy@localhost:5432/dummy',
          migrations: {
            directory: path.resolve(__dirname, 'migrations')
          }
        }
      };
      return;
    }
    
    throw new Error(
      '❌ PostgreSQL sozlamalari topilmadi!\n' +
      'Iltimos, .env faylida quyidagilarni qo\'shing:\n' +
      'POSTGRES_HOST=localhost\n' +
      'POSTGRES_PORT=5432\n' +
      'POSTGRES_DB=hisobot_db\n' +
      'POSTGRES_USER=postgres\n' +
      'POSTGRES_PASSWORD=your_password\n' +
      'yoki\n' +
      'DATABASE_URL=postgresql://user:password@host:port/database\n' +
      'yoki SQLite ishlatish uchun: DB_TYPE=sqlite\n\n' +
      'Railway.com uchun: PostgreSQL service qo\'shing va DATABASE_URL avtomatik yaratiladi.'
    );
  }

  const mainDbConfig = {
    client: 'pg',
    connection: postgresConfig,
    migrations: {
      directory: path.resolve(__dirname, 'migrations')
    },
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      createTimeoutMillis: 10000,
      destroyTimeoutMillis: 5000
    },
    acquireConnectionTimeout: 10000,
    asyncStackTraces: false,
    debug: false
  };

  module.exports = {
    development: mainDbConfig,
    production: {
      ...mainDbConfig,
      pool: {
        ...mainDbConfig.pool,
        min: 5,
        max: 20
      },
      acquireConnectionTimeout: 15000
    }
  };
}
