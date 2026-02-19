// server.js
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const fs = require('fs');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer setup (increased to 50 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory news storage (will reset on server restart)
let newsItems = [];

// ────────────────────────────────────────────────
// Routes – specific routes FIRST
// ────────────────────────────────────────────────

// Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Contact form
app.post('/api/contact', async (req, res) => {
  const { firstName, lastName, studentId, subject, message } = req.body;

  if (!firstName || !lastName || !studentId || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"VVU SRC Contact" <${process.env.EMAIL_USER}>`,
    to: 'senate@vvu.edu.gh',
    replyTo: `${firstName} ${lastName} <${studentId}@vvu.edu.gh>`,
    subject: `Senate Inquiry: ${subject}`,
    text: `Name: ${firstName} ${lastName}\nID: ${studentId}\nSubject: ${subject}\n\n${message}`,
    html: `<h2>New Message</h2><p><b>Name:</b> ${firstName} ${lastName}</p><p><b>ID:</b> ${studentId}</p><p><b>Subject:</b> ${subject}</p><hr><p>${message.replace(/\n/g, '<br>')}</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: 'Sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Documents URL (cache busting)
app.get('/api/documents/:doc', (req, res) => {
  const doc = req.params.doc;
  let id = '';
  if (doc === 'handbook') id = 'documents/student-handbook.pdf';
  else if (doc === 'constitution') id = 'documents/src-constitution.pdf';
  else return res.status(404).json({ error: 'Not found' });

  const ts = Date.now();
  const url = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/v${ts}/${id}`;
  res.json({ success: true, url });
});

// ────────────────────────────────────────────────
// NEWS ENDPOINTS
// ────────────────────────────────────────────────

// Get all news (used by news.html)
app.get('/api/news', (req, res) => {
  // Return newest first (reverse order)
  res.json([...newsItems].reverse());
});

// Create new news (protected – from admin panel)
app.post('/admin/news', (req, res) => {
  const auth = req.headers.authorization || '';
  const [_, b64] = auth.split(' ');
  const [user, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');

  if (user !== 'admin' || pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { title, teaser, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, error: 'Title and content required' });
  }

  const item = {
    id: (newsItems[newsItems.length - 1]?.id || 0) + 1,
    title: title.trim(),
    teaser: teaser?.trim() || title.substring(0, 140) + (title.length > 140 ? '...' : ''),
    content: content.trim(),
    date: new Date().toISOString().split('T')[0]  // YYYY-MM-DD
  };

  newsItems.push(item);
  res.json({ success: true, message: 'News posted', item });
});

// ────────────────────────────────────────────────
// Admin panel (protected)
app.get('/admin', (req, res) => {
  const fp = path.join(__dirname, 'public', 'admin.html');

  if (!fs.existsSync(fp)) {
    console.error('Missing admin.html');
    return res.status(500).send('Admin panel file missing');
  }

  const auth = req.headers.authorization || '';
  const [_, b64] = auth.split(' ');
  const [user, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');

  if (user === 'admin' && pass === process.env.ADMIN_PASSWORD) {
    return res.sendFile(fp);
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  res.status(401).send('Login required');
});

// Upload PDF (protected)
app.post('/admin/upload', upload.single('pdf'), async (req, res) => {
  const auth = req.headers.authorization || '';
  const [_, b64] = auth.split(' ');
  const [user, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');

  if (user !== 'admin' || pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!req.file) return res.status(400).json({ success: false, error: 'No file' });

  const name = req.file.originalname.toLowerCase();
  let pid = '';

  if (name.includes('handbook') || name.includes('student')) pid = 'documents/student-handbook';
  else if (name.includes('constitution') || name.includes('src')) pid = 'documents/src-constitution';
  else return res.status(400).json({ success: false, error: 'Invalid filename' });

  try {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          public_id: pid,
          format: 'pdf',
          overwrite: true
        },
        (err, res) => err ? reject(err) : resolve(res)
      ).end(req.file.buffer);
    });

    res.json({
      success: true,
      message: 'Uploaded',
      url: result.secure_url
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// ────────────────────────────────────────────────
// Catch-all – must be LAST
// ────────────────────────────────────────────────
app.get('*', (req, res) => {
  const fp = path.join(__dirname, 'public', req.path.slice(1));
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.sendFile(fp);
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});