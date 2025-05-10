const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = 3000;
const db = require('./database');


function sanitizeName(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
}

// Set up file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Serve static files
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));

// Route: get all submissions
app.get('/submissions', (req, res) => {
  const filePath = path.join(__dirname, 'submissions.json');
  if (!fs.existsSync(filePath)) return res.json([]);

  const lines = fs.readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(line => line.trim() !== '');

  const data = lines.map(line => JSON.parse(line));
  res.json(data);
});

// Route: get total submission count
app.get('/submission-count', (req, res) => {
  const filePath = path.join(__dirname, 'submissions.json');
  if (!fs.existsSync(filePath)) return res.json({ count: 0 });

  const lines = fs.readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(line => line.trim() !== '');

  res.json({ count: lines.length });
});

// Route: submit form
app.post('/submit', upload.single('idPhoto'), (req, res) => {
  const { firstName, lastName, bank } = req.body;
  const fullName = `${firstName} ${lastName}`;    
  const idFile = req.file;

  const filePath = path.join(__dirname, 'submissions.json');
  const rawName = sanitizeName(`${firstName} ${lastName}`);
  const timestamp = new Date().toISOString();

  let count = 1;
  let allSubmissions = [];
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf-8')
      .trim()
      .split('\n')
      .filter(line => line.trim() !== '');
    allSubmissions = lines.map(line => JSON.parse(line));
    count = allSubmissions.filter(sub => sanitizeName(sub.fullName) === rawName).length + 1;
  }

  const idFileName = `${rawName}-${count}${path.extname(idFile.originalname)}`;
  const newIdPath = path.join('uploads', idFileName);
  fs.renameSync(idFile.path, newIdPath);

  const logEntry = {
    timestamp,
    firstName,
    lastName,
    fullName,
    bank,
    idFilePath: newIdPath,
    id: `${firstName} ${lastName}-${count}`
  };
  

  fs.appendFileSync(filePath, JSON.stringify(logEntry) + '\n');
  res.redirect('/thank-you.html'); // Prevents form resubmission on refresh
});

// Route: generate PDF by ID
app.get('/pdf/:id', (req, res) => {
  const id = req.params.id;
  const filePath = path.join(__dirname, 'submissions.json');
  if (!fs.existsSync(filePath)) return res.status(404).send('No submissions found');

  const lines = fs.readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(line => line.trim() !== '');

  const submissions = lines.map(line => JSON.parse(line));
  const entry = submissions.find(e => e.id === id);
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

  doc.fontSize(16).text(`Full Name: ${entry.fullName}`);
  doc.text(`Bank: ${entry.bank}`);
  doc.text(`Submitted at: ${new Date(entry.timestamp).toLocaleString()}`);
  doc.end();
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
