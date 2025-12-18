// knexfile.js

const path = require('path');

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, 'database.db'),
      // SQLite BUSY xatoliklarini hal qilish
      busyTimeout: 5000, // 5 soniya kutish
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, 'migrations')
    },
    // Connection pool sozlamalari - SQLite uchun optimallashtirilgan
    pool: {
      afterCreate: (conn, cb) => {
        // WAL mode'ni yoqish - yozish va o'qishni parallel qilish
        conn.run('PRAGMA journal_mode = WAL;', (err) => {
          // Development da log qilish, production da emas
          if (err) {
            console.warn('⚠️ WAL mode yoqishda xatolik:', err.message);
          }
          // Busy timeout'ni o'rnatish
          conn.run('PRAGMA busy_timeout = 5000;', (err2) => {
            cb(err || err2, conn);
          });
        });
      },
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 10000,
      destroyTimeoutMillis: 5000,
      createRetryIntervalMillis: 200,
      propagateCreateError: false
    },
    acquireConnectionTimeout: 10000,
    asyncStackTraces: false,
    debug: false
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
        // WAL mode'ni yoqish (logsiz)
        conn.run('PRAGMA journal_mode = WAL;', () => {
          conn.run('PRAGMA busy_timeout = 5000;', () => {
            cb(null, conn);
          });
        });
      },
      min: 5,
      max: 20, // Production uchun optimallashtirilgan
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 15000,
      destroyTimeoutMillis: 5000,
      createRetryIntervalMillis: 200,
      propagateCreateError: false
    },
    acquireConnectionTimeout: 15000,
    asyncStackTraces: false,
    debug: false
  }
};
