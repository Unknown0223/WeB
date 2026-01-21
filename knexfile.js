// knexfile.js

require('dotenv').config(); // .env faylini yuklash (migration'lar uchun)

const path = require('path');

// Database type ni aniqlash - SQLite yoki PostgreSQL
// Railway.com, Render.com, Heroku kabi platformalarda PostgreSQL majburiy
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
const isRender = !!process.env.RENDER;
const isHeroku = !!process.env.HEROKU_APP_NAME;
const isCloudPlatform = isRailway || isRender || isHeroku;

// Cloud platformalarda PostgreSQL majburiy, aks holda SQLite
const useSqlite = !isCloudPlatform && (process.env.DB_TYPE === 'sqlite' || (!process.env.POSTGRES_HOST && !process.env.DATABASE_URL));

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

  if (!postgresConfig) {
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
