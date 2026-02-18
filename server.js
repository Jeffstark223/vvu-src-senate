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

// ────────────────────────────────────────────────
// Cloudinary configuration
// ────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ────────────────────────────────────────────────
// Multer setup – memory storage (direct to Cloudinary)
// ────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max
});

// ────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ────────────────────────────────────────────────
// IMPORTANT: Specific routes MUST come BEFORE the catch-all *
// ────────────────────────────────────────────────

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Contact form API
app.post('/api/contact', async (req, res) => {
  const { firstName, lastName, studentId, subject, message } = req.body;

  if (!firstName || !lastName || !studentId || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Must be Gmail App Password
    },
  });

  const mailOptions = {
    from: `"VVU SRC Contact Form" <${process.env.EMAIL_USER}>`,
    to: 'senate@vvu.edu.gh', // ← replace with real senate email
    replyTo: `${firstName} ${lastName} <${studentId}@vvu.edu.gh>`,
    subject: `New Senate Inquiry: ${subject}`,
    text: `
Name: ${firstName} ${lastName}
Student ID: ${studentId}
Subject: ${subject}

Message:
${message}
    `,
    html: `
      <h2>New Contact Form Submission</h2>
      <p><strong>Name:</strong> ${firstName} ${lastName}</p>
      <p><strong>Student ID:</strong> ${studentId}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <hr>
      <p><strong>Message:</strong><br>${message.replace(/\n/g, '<br>')}</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: 'Message sent successfully!' });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ error: 'Failed to send message. Try again later.' });
  }
});

// Documents API – get latest URL (with cache busting)
app.get('/api/documents/:doc', (req, res) => {
  const doc = req.params.doc;
  let publicId = '';

  if (doc === 'handbook') {
    publicId = 'documents/student-handbook.pdf';
  } else if (doc === 'constitution') {
    publicId = 'documents/src-constitution.pdf';
  } else {
    return res.status(404).json({ error: 'Document not found' });
  }

  const timestamp = Date.now();
  const url = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/v${timestamp}/${publicId}`;

  res.json({ success: true, url });
});

// News API – public read
app.get('/api/news', (req, res) => {
  res.json(newsItems || []);
});

// News API – protected create
app.post('/admin/news', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const base64Credentials = authHeader.split(' ')[1] || '';
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username !== 'admin' || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { title, teaser, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ success: false, error: 'Title and content are required' });
  }

  const newNews = {
    id: newsItems.length ? newsItems[newsItems.length - 1].id + 1 : 1,
    title: title.trim(),
    teaser: teaser ? teaser.trim() : title.substring(0, 100) + (title.length > 100 ? '...' : ''),
    content: content.trim(),
    date: new Date().toISOString().split('T')[0]
  };

  newsItems.push(newNews);

  res.json({ success: true, message: 'News created', item: newNews });
});

// Admin panel – protected route (clean URL: /admin)
app.get('/admin', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'admin.html');

  if (!fs.existsSync(filePath)) {
    console.error(`Admin panel file not found: ${filePath}`);
    return res.status(500).send('Admin panel file is missing on server');
  }

  const authHeader = req.headers.authorization || '';
  const base64Credentials = authHeader.split(' ')[1] || '';
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username === 'admin' && password === process.env.ADMIN_PASSWORD) {
    return res.sendFile(filePath);
  }

  res.set('WWW-Authenticate', 'Basic realm="VVU SRC Admin Panel"');
  res.status(401).send('Authentication required (username: admin)');
});

// Protected document upload endpoint
app.post('/admin/upload', upload.single('pdf'), async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const base64Credentials = authHeader.split(' ')[1] || '';
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username !== 'admin' || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No PDF file received' });
  }

  const originalName = req.file.originalname.toLowerCase();
  let targetPublicId = '';

  if (originalName.includes('handbook') || originalName.includes('student')) {
    targetPublicId = 'documents/student-handbook';
  } else if (originalName.includes('constitution') || originalName.includes('src')) {
    targetPublicId = 'documents/src-constitution';
  } else {
    return res.status(400).json({
      success: false,
      error: 'File name must contain "handbook"/"student" or "constitution"/"src"'
    });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          public_id: targetPublicId,
          format: 'pdf',
          overwrite: true,
          use_filename: false,
          unique_filename: false
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );

      stream.end(req.file.buffer);
    });

    res.json({
      success: true,
      message: `${targetPublicId}.pdf uploaded / updated successfully`,
      url: result.secure_url,
      version: result.version
    });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ success: false, error: 'Upload failed – check server logs' });
  }
});

// ────────────────────────────────────────────────
// Catch-all route – MUST BE LAST
// ────────────────────────────────────────────────
app.get('*', (req, res) => {
  const requestedPath = path.join(__dirname, 'public', req.path.slice(1));
  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
    return res.sendFile(requestedPath);
  }
  // Fallback to index.html
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ────────────────────────────────────────────────
// Start server
// ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});