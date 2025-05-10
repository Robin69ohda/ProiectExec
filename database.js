const Database = require('better-sqlite3');
const db = new Database('submissions.db');

// Create the table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    timestamp TEXT,
    firstName TEXT,
    lastName TEXT,
    fullName TEXT,
    bank TEXT,
    idFilePath TEXT
  )
`).run();

module.exports = db;
