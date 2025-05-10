const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('./database');

const app = express();
const PORT = 3000;

function sanitizeName(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
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

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Serve static files
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));

// Submission route
app.post('/submit', upload.single('idPhoto'), (req, res) => {
  const { firstName, lastName, bank } = req.body;
  const fullName = `${firstName} ${lastName}`;
  const rawName = sanitizeName(fullName);
  const timestamp = new Date();

  // Count previous submissions from this user
  const previousCount = db.prepare('SELECT COUNT(*) as count FROM submissions WHERE fullName = ?').get(fullName).count;
  const count = previousCount + 1;

  // Save the file with a structured name
  const idFile = req.file;
  const idFileName = `${rawName}-${count}${path.extname(idFile.originalname)}`;
  const newIdPath = path.join('uploads', idFileName);
  fs.renameSync(idFile.path, newIdPath);

  const id = `${fullName} ${count}`;

  // Save to database
  db.prepare(`
    INSERT INTO submissions (id, timestamp, firstName, lastName, fullName, bank, idFilePath)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    timestamp.toISOString(),
    firstName,
    lastName,
    fullName,
    bank,
    newIdPath
  );

  res.redirect('/thank-you.html');
});

// Admin: get all submissions
app.get('/submissions', (req, res) => {
  const rows = db.prepare('SELECT * FROM submissions ORDER BY timestamp DESC').all();
  res.json(rows);
});

// Admin: get total submission count
app.get('/submission-count', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM submissions').get().count;
  res.json({ count });
});

// PDF generation
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
