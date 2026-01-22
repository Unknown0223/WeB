// knexfile.js

require('dotenv').config(); // .env faylini yuklash (migration'lar uchun)

const path = require('path');

// Database type ni aniqlash - SQLite yoki PostgreSQL
const useSqlite = process.env.DB_TYPE === 'sqlite' || (!process.env.POSTGRES_HOST && !process.env.DATABASE_URL);

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
    const databaseUrl = process.env.DATABASE_URL;
    
    // Railway.com'da reference bo'lsa (${{Service.Variable}}), uni qabul qilish
    // Railway runtime'da reference'ni avtomatik resolve qiladi
    if (databaseUrl) {
      // Reference yoki oddiy connection string bo'lishi mumkin
      // Railway runtime'da reference avtomatik resolve qilinadi
      return databaseUrl;
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
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;
  const databaseUrl = process.env.DATABASE_URL;

  if (!postgresConfig) {
    // Railway.com'da DATABASE_URL tekshirish
    if (isRailway) {
      const error = new Error(
        'Railway.com\'da DATABASE_URL sozlanmagan!\n' +
        'Iltimos, Railway.com\'da PostgreSQL service qo\'shing va uni web service bilan bog\'lang.\n' +
        'PostgreSQL service qo\'shilganda, DATABASE_URL avtomatik yaratiladi.'
      );
      // Logger ishlatish (agar mavjud bo'lsa)
      if (typeof console !== 'undefined') {
        console.error('❌ [DB] ❌ [DB] Railway.com\'da DATABASE_URL sozlanmagan!');
        console.error('❌ [DB] ❌ [DB] Iltimos, Railway.com\'da PostgreSQL service qo\'shing va uni web service bilan bog\'lang.');
        console.error('❌ [DB] ❌ [DB] PostgreSQL service qo\'shilganda, DATABASE_URL avtomatik yaratiladi.');
      }
      throw error;
    } else {
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
        'yoki SQLite ishlatish uchun: DB_TYPE=sqlite'
      );
    }
  }
  
  // Railway.com'da reference bo'lsa, runtime'da resolve qilinishini kutish
  // Bu holatda connection string runtime'da to'g'ri bo'ladi
  if (isRailway && databaseUrl && databaseUrl.includes('${{')) {
    // Reference mavjud, lekin hali resolve qilinmagan
    // Bu normal, Railway runtime'da resolve qiladi
    // Faqat connection string to'g'ri formatda bo'lishi kerak
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
