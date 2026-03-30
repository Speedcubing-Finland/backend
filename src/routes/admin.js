
const express = require('express');
const db = require('../db'); // Ensure the path is correct
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const verifyToken = require('../middleware/auth');
const { submissions } = require('./public'); // Import shared submissions array
const {
  sendRegistrationApprovedEmail,
  sendCompetitionAnnouncementEmail,
} = require('../services/emailService');
const { runCompetitionNotificationCheck } = require('../services/competitionNotifierService');
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


// Endpoint to fetch all pending registrations from DB
router.get('/submissions', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM pending_members ORDER BY submitted_at ASC');
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching pending_members:', err);
    res.status(500).send('Error fetching pending registrations');
  }
});


// Endpoint to approve a pending registration by id
router.post('/approve', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('Missing id');

  try {
    // Fetch the pending registration
    const [rows] = await db.execute('SELECT * FROM pending_members WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('Pending registration not found');
    const approvedSubmission = rows[0];

    // Check for duplicate in members
    const [dup] = await db.execute('SELECT COUNT(*) AS count FROM members WHERE email = ?', [approvedSubmission.email]);
    if (dup[0].count > 0) return res.status(400).send('This email address is already registered');

    // Insert into members
    const insertQuery = `
      INSERT INTO members (first_name, last_name, city, email, wca_id, birth_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await db.execute(insertQuery, [
      approvedSubmission.first_name,
      approvedSubmission.last_name,
      approvedSubmission.city,
      approvedSubmission.email,
      approvedSubmission.wca_id || null,
      approvedSubmission.birth_date
    ]);

    // Remove from pending_members
    await db.execute('DELETE FROM pending_members WHERE id = ?', [id]);

    // (Optional) Send approval email (non-blocking)
    if (sendRegistrationApprovedEmail) {
      sendRegistrationApprovedEmail(
        approvedSubmission.email,
        approvedSubmission.first_name,
        approvedSubmission.last_name
      )
        .then(emailResult => {
          if (emailResult.success) {
            console.log(`Approval email sent to ${approvedSubmission.email}`);
          } else {
            console.warn(`Failed to send approval email to ${approvedSubmission.email}:`, emailResult.reason || emailResult.error);
          }
        })
        .catch(err => console.error('Email send error:', err));
    }

    res.status(200).send('Submission approved successfully');
  } catch (err) {
    console.error('Error approving registration:', err);
    res.status(500).send('Error approving registration');
  }
});


// Endpoint to reject a pending registration by id
router.post('/reject', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('Missing id');
  try {
    const [result] = await db.execute('DELETE FROM pending_members WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).send('Pending registration not found');
    res.status(200).send('Submission rejected');
  } catch (err) {
    console.error('Error rejecting registration:', err);
    res.status(500).send('Error rejecting registration');
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

// Endpoint to manually trigger competition notification check
router.post('/notify-competitions', async (req, res) => {
  try {
    const result = await runCompetitionNotificationCheck({ manual: true });
    res.status(200).json(result);
  } catch (err) {
    console.error('Error running competition notifier:', err);
    res.status(500).json({ error: 'Error running competition notifier' });
  }
});

// Endpoint to send a preview competition email to a single address
router.post('/notify-competitions-preview', async (req, res) => {
  const { email, competitionId } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'Missing email in request body' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://www.worldcubeassociation.org/api/v0/competitions?country_iso2=FI&start=${today}`;

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({
        error: `Failed to fetch competitions from WCA API (${response.status})`,
      });
    }

    const competitions = await response.json();
    if (!Array.isArray(competitions) || competitions.length === 0) {
      return res.status(404).json({ error: 'No upcoming Finland competitions found' });
    }

    const selectedCompetition = competitionId
      ? competitions.find((competition) => competition.id === competitionId)
      : competitions[0];

    if (!selectedCompetition) {
      return res.status(404).json({
        error: `Competition not found for id: ${competitionId}`,
      });
    }

    const sendResult = await sendCompetitionAnnouncementEmail(
      email,
      'Testikäyttäjä',
      selectedCompetition
    );

    if (!sendResult?.success) {
      return res.status(500).json({
        error: 'Failed to send preview email',
        details: sendResult?.reason || sendResult?.error || 'Unknown error',
      });
    }

    return res.status(200).json({
      status: 'ok',
      to: email,
      competition: {
        id: selectedCompetition.id,
        name: selectedCompetition.name,
        start_date: selectedCompetition.start_date,
        end_date: selectedCompetition.end_date,
      },
    });
  } catch (err) {
    console.error('Error sending preview competition email:', err);
    return res.status(500).json({ error: 'Error sending preview competition email' });
  }
});

module.exports = router;
