const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Clean up any existing database files
// const dbFiles = ['submissions.db', 'submissions.db-shm', 'submissions.db-wal'];
// dbFiles.forEach(file => {
//     const filePath = path.join(__dirname, file);
//     if (fs.existsSync(filePath)) {
//         try {
//             fs.unlinkSync(filePath);
//         } catch (err) {
//             console.warn(`Could not delete ${file}:`, err.message);
//         }
//     }
// });

const db = new Database(path.join(__dirname, 'submissions.db'), {
    verbose: console.log,
    fileMustExist: false,
    timeout: 10000
});

// Set pragmas
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

process.on('exit', () => {
    if (db) {
        console.log('Closing database connection...');
        db.close();
    }
});

process.on('SIGINT', () => {
    if (db) {
        console.log('Closing database connection...');
        db.close();
    }
    process.exit();
});

module.exports = db;
