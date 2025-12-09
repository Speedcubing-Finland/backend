
const express = require('express');
const db = require('../db'); // Ensure the path is correct
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const verifyToken = require('../middleware/auth');
const { submissions } = require('./public'); // Import shared submissions array
const router = express.Router();

// Login endpoint - no auth required
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Validate input
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Check credentials against environment variables
    if (username !== process.env.ADMIN_USERNAME) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password with hashed password
    const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token (expires in 24 hours)
    const token = jwt.sign(
      { username: username, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      token,
      username,
      expiresIn: '24h'
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// All routes below require authentication
router.use(verifyToken);

// Endpoint to fetch all submissions
router.get('/submissions', (req, res) => {
  res.status(200).json(submissions);
});

// Endpoint to approve a submission
router.post('/approve', async (req, res) => {
    const { index } = req.body;
  
    if (index < 0 || index >= submissions.length) {
      return res.status(400).send('Invalid submission index');
    }
  
    const approvedSubmission = submissions.splice(index, 1)[0];
  
    const checkQuery = 'SELECT COUNT(*) AS count FROM members WHERE email = ?';
  
    try {
      const [rows] = await db.execute(checkQuery, [approvedSubmission.email]);
      if (rows[0].count > 0) {
        return res.status(400).send('This email address is already registered');
      }
  
      const insertQuery = `
        INSERT INTO members (first_name, last_name, city, email, wca_id, birth_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const [result] = await db.execute(insertQuery, [
        approvedSubmission.firstName,
        approvedSubmission.lastName,
        approvedSubmission.city,
        approvedSubmission.email,
        approvedSubmission.wcaId || null,
        approvedSubmission.birthDate,
      ]);
  
      console.log('Data saved successfully:', result);
      res.status(200).send('Submission approved successfully');
    } catch (err) {
      console.error('Error inserting data into the database:', err);
      res.status(500).send('Error saving to database');
    }
  });

// Endpoint to reject a submission
router.post('/reject', (req, res) => {
  const { index } = req.body;

  if (index >= 0 && index < submissions.length) {
    // Remove the submission from the temporary storage
    submissions.splice(index, 1);
    res.status(200).send('Submission rejected');
  } else {
    res.status(400).send('Invalid submission index');
  }
});


// Endpoint to get all members (for comparison)
router.get('/members', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT wca_id, email, first_name, last_name FROM members');
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).send('Error fetching members');
  }
});

module.exports = router;
