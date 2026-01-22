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
    // Production'da log qilmaymiz (faqat error loglar)

    // Database mavjudligini tekshirish
    const checkResult = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (checkResult.rows.length > 0) {
      // Database allaqachon mavjud
    } else {
      // Database yaratish
      await client.query(`CREATE DATABASE ${dbName}`);
    }

    await client.end();
    process.exit(0);
  } catch (error) {
    // Faqat xatoliklarni log qilamiz
    console.error('❌ Xatolik:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   PostgreSQL server ishlamayapti. Server ishga tushiring.');
    } else if (error.code === '28P01') {
      console.error('   Autentifikatsiya xatolik - username yoki parol noto\'g\'ri');
    } else if (error.code === '42P04') {
      // Database allaqachon mavjud - bu xatolik emas
      await client.end().catch(() => {});
      process.exit(0);
    }
    await client.end().catch(() => {});
    process.exit(1);
  }
}

createDatabase();

