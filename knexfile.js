// knexfile.js

const path = require('path');

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, 'database.db')
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, 'migrations')
    }
  },
  // Kelajakda production server uchun ham sozlamalar qo'shish mumkin
  // production: { ... }
};
