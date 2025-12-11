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
          if (err) {
            console.warn('⚠️ WAL mode yoqishda xatolik:', err.message);
          } else {
            console.log('✅ SQLite WAL mode yoqildi');
          }
          // Busy timeout'ni o'rnatish
          conn.run('PRAGMA busy_timeout = 5000;', (err2) => {
            if (err2) {
              console.warn('⚠️ Busy timeout o\'rnatishda xatolik:', err2.message);
            }
            cb(err || err2, conn);
          });
        });
      },
      min: 1, // SQLite uchun minimal
      max: 5, // SQLite uchun optimal (locked xatoliklarini kamaytirish)
      acquireTimeoutMillis: 10000, // 10 soniya
      idleTimeoutMillis: 5000, // 5 soniya
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
          if (err) {
            console.warn('⚠️ WAL mode yoqishda xatolik:', err.message);
          } else {
            console.log('✅ SQLite WAL mode yoqildi');
          }
          // Busy timeout'ni o'rnatish
          conn.run('PRAGMA busy_timeout = 5000;', (err2) => {
            if (err2) {
              console.warn('⚠️ Busy timeout o\'rnatishda xatolik:', err2.message);
            }
            cb(err || err2, conn);
          });
        });
      },
      min: 1, // SQLite uchun minimal
      max: 5, // SQLite uchun optimal (locked xatoliklarini kamaytirish)
      acquireTimeoutMillis: 10000, // 10 soniya
      idleTimeoutMillis: 5000, // 5 soniya
      reapIntervalMillis: 1000,
      createTimeoutMillis: 10000,
      destroyTimeoutMillis: 5000,
      createRetryIntervalMillis: 200,
      propagateCreateError: false
    },
    acquireConnectionTimeout: 10000,
    asyncStackTraces: false,
    debug: false
  }
};
