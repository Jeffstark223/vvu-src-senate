// server.js
// Simplified version: no admin panel, no news, no PDF upload
// Only contact form + static file serving

const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Contact form endpoint
app.post('/api/contact', async (req, res) => {
  const { firstName, lastName, studentId, subject, message } = req.body;

  if (!firstName || !lastName || !studentId || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Use App Password for Gmail
    },
  });

  const mailOptions = {
    from: `"VVU SRC Contact Form" <${process.env.EMAIL_USER}>`,
    to: 'senate@vvu.edu.gh', // ← Change to real senate email
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

// Optional: Documents redirect with cache busting
// (You can remove this route if you prefer direct links in documents.html)
app.get('/api/documents/:doc', (req, res) => {
  const doc = req.params.doc.toLowerCase();
  let filename = '';

  if (doc === 'handbook') {
    filename = 'student-handbook.pdf';
  } else if (doc === 'constitution') {
    filename = 'src-constitution.pdf';
  } else {
    return res.status(404).json({ error: 'Document not found' });
  }

  const filePath = path.join(__dirname, 'public', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on server' });
  }

  // Simple redirect with cache-busting query param
  const timestamp = Date.now();
  res.redirect(`/${filename}?v=${timestamp}`);
});

// Catch-all route – must be last
app.get('*', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  // Fallback to index.html
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Site should be live at: http://localhost:${PORT}`);
});