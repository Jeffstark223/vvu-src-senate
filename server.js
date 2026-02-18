// server.js
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.set('strict routing', false);
const PORT = process.env.PORT || 3000;

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