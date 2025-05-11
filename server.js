const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('./database');

const app = express();
const PORT = 3000;

// Create uploads directory if it doesn't exist
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

function sanitizeName(name) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
}

function initializeDatabase() {
    try {
        const tables = [
            // 'DROP TABLE IF EXISTS submissions',
            // 'DROP TABLE IF EXISTS people',
            `CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                firstName TEXT,
                lastName TEXT,
                fullName TEXT UNIQUE,
                submissionCount INTEGER DEFAULT 0
            )`,
            `CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                firstName TEXT,
                lastName TEXT,
                fullName TEXT,
                bank TEXT,
                idFilePath TEXT,
                personId INTEGER,
                FOREIGN KEY(personId) REFERENCES people(id) ON DELETE CASCADE
            )`
        ];

        // Execute each statement separately
        tables.forEach(sql => {
            try {
                db.prepare(sql).run();
            } catch (err) {
                console.error(`Error executing SQL: ${sql}`, err);
                throw err;
            }
        });

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

// Set up file storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

// Middleware
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));

// Admin Routes
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/person/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'person.html'));
});

// API Routes
app.get('/people', (req, res) => {
    const people = db.prepare(`
        SELECT * FROM people
        ORDER BY submissionCount DESC, fullName ASC
    `).all();
    res.json(people);
});

app.get('/person/:id', (req, res) => {
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
    if (!person) {
        return res.status(404).json({ error: 'Person not found' });
    }

    const submissions = db.prepare('SELECT * FROM submissions WHERE personId = ? ORDER BY timestamp DESC')
        .all(req.params.id);

    res.json({ person, submissions });
});

app.get('/submissions', (req, res) => {
    const rows = db.prepare('SELECT * FROM submissions ORDER BY timestamp DESC').all();
    res.json(rows);
});

app.get('/submission-count', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM submissions').get().count;
    res.json({ count });
});

// Form Submission Route
app.post('/submit', upload.single('idPhoto'), (req, res) => {
    try {
        const { firstName, lastName, bank } = req.body;
        const fullName = `${firstName} ${lastName}`;
        const rawName = sanitizeName(fullName);
        const timestamp = new Date();

        const transaction = db.transaction(() => {
            const insertOrUpdatePerson = db.prepare(`
                INSERT INTO people (firstName, lastName, fullName, submissionCount)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(fullName) 
                DO UPDATE SET 
                    submissionCount = submissionCount + 1
                RETURNING *
            `);

            const person = insertOrUpdatePerson.get(firstName, lastName, fullName);

            const idFile = req.file;
            const idFileName = `${rawName}-${person.submissionCount}${path.extname(idFile.originalname)}`;
            const newIdPath = path.join('uploads', idFileName);
            fs.renameSync(idFile.path, newIdPath);

            const id = `${fullName} ${person.submissionCount}`;

            db.prepare(`
                INSERT INTO submissions (id, timestamp, firstName, lastName, fullName, bank, idFilePath, personId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                timestamp.toISOString(),
                firstName,
                lastName,
                fullName,
                bank,
                newIdPath,
                person.id
            );
        });

        transaction();
        res.redirect('/thank-you.html');
    } catch (error) {
        console.error('Submission error:', error);
        res.status(500).send('An error occurred during submission');
    }
});

// PDF Generation Route
app.get('/pdf/:id', (req, res) => {
    const entry = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!entry) return res.status(404).send('Submission not found');

    const doc = new PDFDocument();
    res.setHeader('Content-Disposition', `attachment; filename=${entry.id}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    const imagePath = path.join(__dirname, entry.idFilePath);
    if (fs.existsSync(imagePath)) {
        try {
            doc.image(imagePath, {
                fit: [400, 400],
                align: 'center',
                valign: 'center'
            });
            doc.moveDown();
        } catch (err) {
            doc.text('⚠️ Error displaying image.');
        }
    } else {
        doc.text('⚠️ ID image not found.');
    }

    doc.fontSize(16).text(`Name: ${entry.fullName}`);
    doc.text(`Bank: ${entry.bank}`);
    doc.text(`Submitted at: ${new Date(entry.timestamp).toLocaleString()}`);
    doc.end();
});

// Reset Database Route
app.post('/reset-database', (req, res) => {
    try {
        // First delete all files
        if (fs.existsSync('uploads')) {
            const files = fs.readdirSync('uploads');
            for (const file of files) {
                try {
                    fs.unlinkSync(path.join('uploads', file));
                } catch (err) {
                    console.error(`Error deleting file ${file}:`, err);
                }
            }
        }

        // Then reinitialize database
        initializeDatabase();

        res.json({ message: 'Database and uploads reset successfully' });
    } catch (error) {
        console.error('Reset failed:', error);
        res.status(500).json({ error: 'Failed to reset database: ' + error.message });
    }
});

// Delete Route
app.delete('/people/:id', (req, res) => {
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
    if (!person) {
        return res.status(404).json({ error: 'Person not found' });
    }

    db.prepare('DELETE FROM people WHERE id = ?').run(req.params.id);
    res.json({ message: 'Person and all their submissions deleted successfully' });
});

app.get('/test-db', (req, res) => {
    try {
        // Test query to check if database is accessible
        const count = db.prepare('SELECT COUNT(*) as count FROM people').get();
        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table'
        `).all();

        res.json({
            status: 'Database is connected',
            peopleCount: count.count,
            tables: tables.map(t => t.name)
        });
    } catch (error) {
        res.status(500).json({
            error: 'Database error',
            message: error.message
        });
    }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Closing database connection...');
    db.close();
    process.exit(0);
});

// Start the server with delay to allow database initialization
const startServer = async () => {
    try {
        // Wait a moment before initializing
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        initializeDatabase();
        
        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

// Start the server
startServer();