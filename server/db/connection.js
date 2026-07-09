const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure the data directory exists before opening the database file.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);

// Sensible SQLite defaults: enforce FKs, better concurrency.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
