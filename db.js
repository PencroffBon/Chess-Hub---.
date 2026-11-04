'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      rating INTEGER DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      tournaments_won INTEGER DEFAULT 0,
      created_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      tc_key TEXT,
      result TEXT,
      reason TEXT,
      ended_at BIGINT,
      moves JSONB,
      fen TEXT,
      white_id TEXT,
      white_name TEXT,
      white_rating INTEGER,
      black_id TEXT,
      black_name TEXT,
      black_rating INTEGER
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      room TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      ts BIGINT
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT,
      tc_key TEXT,
      status TEXT,
      created_by TEXT,
      created_at BIGINT,
      started_at BIGINT,
      finished_at BIGINT,
      total_rounds INTEGER,
      round INTEGER,
      rounds JSONB,
      players JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_chat_room ON chat_messages(room, ts);
    CREATE INDEX IF NOT EXISTS idx_history_white ON games(white_id);
    CREATE INDEX IF NOT EXISTS idx_history_black ON games(black_id);
  `);
}

module.exports = { pool, query, initDb };