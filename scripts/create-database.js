#!/usr/bin/env node

/**
 * PostgreSQL database yaratish script'i
 */

require('dotenv').config();
const { Client } = require('pg');

const dbName = process.env.POSTGRES_DB || 'hisobot_db';
const config = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: 'postgres', // Avval 'postgres' database'ga ulanamiz
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || ''
};

const client = new Client(config);

async function createDatabase() {
  try {
    await client.connect();
    console.log('✅ PostgreSQL server ga ulandi');

    // Database mavjudligini tekshirish
    const checkResult = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (checkResult.rows.length > 0) {
      console.log(`✅ Database "${dbName}" allaqachon mavjud`);
    } else {
      // Database yaratish
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database "${dbName}" yaratildi`);
    }

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Xatolik:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   PostgreSQL server ishlamayapti. Server ishga tushiring.');
    } else if (error.code === '28P01') {
      console.error('   Autentifikatsiya xatolik - username yoki parol noto\'g\'ri');
    } else if (error.code === '42P04') {
      console.log(`✅ Database "${dbName}" allaqachon mavjud`);
      await client.end().catch(() => {});
      process.exit(0);
    }
    await client.end().catch(() => {});
    process.exit(1);
  }
}

createDatabase();

