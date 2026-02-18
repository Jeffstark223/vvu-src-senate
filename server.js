// server.js
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
require('dotenv').config();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const app = express();
app.set('strict routing', false);
const PORT = process.env.PORT || 3000;

// Memory storage → file goes to RAM → we upload to Cloudinary immediately
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max – reasonable for constitutions/handbooks
});

// Middleware
app.use(express.json());                    // for parsing JSON bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));  // serve static files

// Serve index.html as root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for other HTML pages (so /contact.html, /news.html etc. work)
app.get('*', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  res.sendFile(filePath, (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'public', 'index.html')); // fallback to SPA-style if needed
    }
  });
});

// Contact form endpoint
app.post('/api/contact', async (req, res) => {
  const { firstName, lastName, studentId, subject, message } = req.body;

  if (!firstName || !lastName || !studentId || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // ────────────────────────────────────────
// ADMIN – Protected PDF upload page (very basic auth for now)
app.get('/admin/upload', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const base64Credentials = authHeader.split(' ')[1] || '';
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username === 'admin' && password === process.env.ADMIN_PASSWORD) {
    return res.sendFile(path.join(__dirname, 'public', 'admin-upload.html'));
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin – Document Upload"');
  res.status(401).send('Authentication required. Use admin credentials.');
});

// ────────────────────────────────────────
// Handle actual PDF upload (POST)
app.post('/admin/upload', upload.single('pdf'), async (req, res) => {
  // Re-check auth (defense in depth)
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
      error: 'File name must contain "handbook"/"student" or "constitution"/"src" to be accepted'
    });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          public_id: targetPublicId,
          format: 'pdf',
          overwrite: true,               // replace old version
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

// ────────────────────────────────────────
// Public endpoints so frontend can get latest PDF URLs
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

  // Cache-busting timestamp so browser gets fresh version after upload
  const timestamp = Date.now();
  const url = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/v${timestamp}/${publicId}`;

  res.json({ success: true, url });
});

  // Nodemailer setup (example using Gmail – better use app password or different service)
  const transporter = nodemailer.createTransport({
    service: 'gmail',   // ← change to your provider
    auth: {
      user: process.env.EMAIL_USER,      // your-email@gmail.com
      pass: process.env.EMAIL_PASS,      // App Password (NOT normal password)
    },
  });

  const mailOptions = {
    from: `"VVU SRC Contact Form" <${process.env.EMAIL_USER}>`,
    to: 'senate@vvu.edu.gh',             // real senate email
    replyTo: `${firstName} ${lastName} <${studentId}@vvu.edu.gh>`, // optional
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});