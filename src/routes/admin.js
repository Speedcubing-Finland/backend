
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

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Fetch the pending registration, locking the row so that concurrent
    // approvals (e.g. the bulk approve button) cannot process it twice
    const [rows] = await connection.execute(
      'SELECT * FROM pending_members WHERE id = ? FOR UPDATE',
      [id]
    );
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).send('Pending registration not found');
    }
    const approvedSubmission = rows[0];

    // Check for duplicate in members
    const [dup] = await connection.execute(
      'SELECT COUNT(*) AS count FROM members WHERE email = ?',
      [approvedSubmission.email]
    );
    if (dup[0].count > 0) {
      await connection.rollback();
      return res.status(400).send('This email address is already registered');
    }

    // Insert into members, keeping the date the application was submitted
    const insertQuery = `
      INSERT INTO members (first_name, last_name, city, email, wca_id, birth_date, submitted_at, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await connection.execute(insertQuery, [
      approvedSubmission.first_name,
      approvedSubmission.last_name,
      approvedSubmission.city,
      approvedSubmission.email,
      approvedSubmission.wca_id || null,
      approvedSubmission.birth_date,
      approvedSubmission.submitted_at || null
    ]);

    // Remove from pending_members
    await connection.execute('DELETE FROM pending_members WHERE id = ?', [id]);

    await connection.commit();

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
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error('Error rolling back approval:', rollbackErr);
      }
    }
    console.error('Error approving registration:', err);
    res.status(500).send('Error approving registration');
  } finally {
    if (connection) connection.release();
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
    const [rows] = await db.execute(
      `SELECT id, first_name, last_name, city, email, wca_id, birth_date,
              submitted_at, approved_at, edited_at
       FROM members`
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).send('Error fetching members');
  }
});

// Endpoint to update a member by id
router.put('/members/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, city, email, wca_id, birth_date } = req.body || {};

  const clean = (value) => (typeof value === 'string' ? value.trim() : '');
  const member = {
    first_name: clean(first_name),
    last_name: clean(last_name),
    city: clean(city),
    email: clean(email),
    birth_date: clean(birth_date),
    wca_id: clean(wca_id) || null
  };

  const missing = ['first_name', 'last_name', 'city', 'email', 'birth_date']
    .filter((field) => !member[field]);
  if (missing.length > 0) {
    return res.status(400).send('All required fields must be filled.');
  }

  try {
    const [existing] = await db.execute('SELECT id FROM members WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).send('Member not found');

    // The member keeps its own email, so exclude it from the duplicate check
    const [dup] = await db.execute(
      'SELECT COUNT(*) AS count FROM members WHERE email = ? AND id != ?',
      [member.email, id]
    );
    if (dup[0].count > 0) {
      return res.status(400).send('This email address is already registered');
    }

    const updateQuery = `
      UPDATE members
      SET first_name = ?, last_name = ?, city = ?, email = ?, wca_id = ?, birth_date = ?, edited_at = NOW()
      WHERE id = ?
    `;
    await db.execute(updateQuery, [
      member.first_name,
      member.last_name,
      member.city,
      member.email,
      member.wca_id,
      member.birth_date,
      id
    ]);

    const [updated] = await db.execute(
      `SELECT id, first_name, last_name, city, email, wca_id, birth_date,
              submitted_at, approved_at, edited_at
       FROM members WHERE id = ?`,
      [id]
    );

    res.status(200).json(updated[0]);
  } catch (err) {
    console.error('Error updating member:', err);
    res.status(500).send('Error updating member');
  }
});


// ---------------------------------------------------------------------------
// Announcements (news and statutory meeting invitations)
// ---------------------------------------------------------------------------

const ANNOUNCEMENT_TYPES = ['meeting_invitation', 'news'];

const readAnnouncement = (body = {}) => {
  const clean = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    type: ANNOUNCEMENT_TYPES.includes(body.type) ? body.type : 'news',
    title: clean(body.title),
    body: clean(body.body),
    meeting_at: clean(body.meeting_at) || null,
    location: clean(body.location) || null
  };
};

const validateAnnouncement = (announcement) => {
  if (!announcement.title || !announcement.body) {
    return 'Title and body are required';
  }
  // Under the Associations Act an invitation must state when and where the
  // meeting is held, so these are required for invitations specifically.
  if (announcement.type === 'meeting_invitation' && (!announcement.meeting_at || !announcement.location)) {
    return 'A meeting invitation must state the meeting time and location';
  }
  return null;
};

// A meeting notice stays visible until the day after the meeting
const expiryFromMeeting = (meetingAt) => {
  if (!meetingAt) return null;
  const meeting = new Date(`${meetingAt}`.replace(' ', 'T'));
  if (Number.isNaN(meeting.getTime())) return null;
  meeting.setDate(meeting.getDate() + 1);
  const pad = (n) => `${n}`.padStart(2, '0');
  return `${meeting.getFullYear()}-${pad(meeting.getMonth() + 1)}-${pad(meeting.getDate())} ` +
    `${pad(meeting.getHours())}:${pad(meeting.getMinutes())}:${pad(meeting.getSeconds())}`;
};

const ANNOUNCEMENT_COLUMNS = `id, type, title, body, meeting_at, location,
       published_at, expires_at, emailed_at, emailed_count, created_at, edited_at`;

const fetchAnnouncement = async (id) => {
  const [rows] = await db.execute(
    `SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcements WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
};

// List every announcement, drafts included
router.get('/announcements', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcements ORDER BY created_at DESC`
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching announcements:', err);
    res.status(500).send('Error fetching announcements');
  }
});

// Create a draft. Publishing is a separate, deliberate action.
router.post('/announcements', async (req, res) => {
  const announcement = readAnnouncement(req.body);
  const problem = validateAnnouncement(announcement);
  if (problem) return res.status(400).send(problem);

  try {
    const [result] = await db.execute(
      `INSERT INTO announcements (type, title, body, meeting_at, location)
       VALUES (?, ?, ?, ?, ?)`,
      [announcement.type, announcement.title, announcement.body, announcement.meeting_at, announcement.location]
    );
    const created = await fetchAnnouncement(result.insertId);
    res.status(201).json(created);
  } catch (err) {
    console.error('Error creating announcement:', err);
    res.status(500).send('Error creating announcement');
  }
});

// Edit an announcement. published_at is deliberately absent from this query:
// it is evidence of when the notice period started and must never move.
router.put('/announcements/:id', async (req, res) => {
  const { id } = req.params;
  const announcement = readAnnouncement(req.body);
  const problem = validateAnnouncement(announcement);
  if (problem) return res.status(400).send(problem);

  try {
    const existing = await fetchAnnouncement(id);
    if (!existing) return res.status(404).send('Announcement not found');

    await db.execute(
      `UPDATE announcements
       SET type = ?, title = ?, body = ?, meeting_at = ?, location = ?, edited_at = NOW()
       WHERE id = ?`,
      [announcement.type, announcement.title, announcement.body, announcement.meeting_at, announcement.location, id]
    );

    res.status(200).json(await fetchAnnouncement(id));
  } catch (err) {
    console.error('Error updating announcement:', err);
    res.status(500).send('Error updating announcement');
  }
});

// Publish. Writes the publication date once and refuses to do it twice.
router.post('/announcements/:id/publish', async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await fetchAnnouncement(id);
    if (!existing) return res.status(404).send('Announcement not found');
    if (existing.published_at) {
      return res.status(409).send('Already published; the publication date cannot be changed');
    }

    const expiresAt = expiryFromMeeting(existing.meeting_at);
    await db.execute(
      'UPDATE announcements SET published_at = NOW(), expires_at = ? WHERE id = ?',
      [expiresAt, id]
    );

    res.status(200).json(await fetchAnnouncement(id));
  } catch (err) {
    console.error('Error publishing announcement:', err);
    res.status(500).send('Error publishing announcement');
  }
});

router.delete('/announcements/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.execute('DELETE FROM announcements WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).send('Announcement not found');
    res.status(200).send('Announcement deleted');
  } catch (err) {
    console.error('Error deleting announcement:', err);
    res.status(500).send('Error deleting announcement');
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
