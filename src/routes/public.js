const express = require('express');
const db = require('../db');
const { sendRegistrationPendingEmail } = require('../services/emailService');
const router = express.Router();



// Public endpoint to handle member registration form submissions
router.post('/submit-member', async (req, res) => {
  const submission = req.body;

  // Validation for required fields
  if (!submission.firstName || !submission.lastName || !submission.city || !submission.email || !submission.birthDate) {
    return res.status(400).send('All required fields must be filled.');
  }


  // Check for duplicate email in pending_members table
  const [pendingRows] = await db.execute('SELECT COUNT(*) AS count FROM pending_members WHERE email = ?', [submission.email]);
  if (pendingRows[0].count > 0) {
    return res.status(400).send('Sähköposti odottaa jo hyväksyntää.');
  }

  try {
    // Check for duplicate email in the members table
    const query = `SELECT COUNT(*) AS count FROM members WHERE email = ?`;
    const [results] = await db.execute(query, [submission.email]);
    if (results[0].count > 0) {
      return res.status(400).send('Sähköposti on jo rekisteröity.');
    }

    // Save submission to pending_members table
    // Consent is only recorded when the form actually sends it: an unticked
    // box, an old cached form or a malformed request all mean "no"
    const competitionEmails = submission.competitionEmails === true ? 1 : 0;

    const insertQuery = `
      INSERT INTO pending_members (first_name, last_name, city, email, wca_id, birth_date, competition_emails)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await db.execute(insertQuery, [
      submission.firstName,
      submission.lastName,
      submission.city,
      submission.email,
      submission.wcaId || null,
      submission.birthDate,
      competitionEmails
    ]);
    console.log('Submission saved to pending_members:', submission);

    // (Optional) Send confirmation email (non-blocking)
    if (sendRegistrationPendingEmail) {
      sendRegistrationPendingEmail(
        submission.email,
        submission.firstName,
        submission.lastName,
        submission.city,
        submission.email,
        submission.wcaId,
        submission.birthDate
      )
        .then(result => {
          if (result.success) {
            console.log(`Pending email sent to ${submission.email}`);
          } else {
            console.warn(`Failed to send pending email to ${submission.email}:`, result.reason || result.error);
          }
        })
        .catch(err => console.error('Email send error:', err));
    }

    res.status(200).send('Submission received successfully');
  } catch (err) {
    console.error('Error checking database or handling submission:', err);
    res.status(500).send('Error checking for duplicate email or saving submission.');
  }
});

// ---------------------------------------------------------------------------
// Unsubscribing from competition announcements
//
// Keyed by a 128-bit random token, so the link in an email works without a
// login and cannot be guessed or enumerated.
// ---------------------------------------------------------------------------

const setCompetitionEmails = async (req, res, subscribed) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).send('Missing token');

  try {
    const [result] = await db.execute(
      `UPDATE members SET competition_emails = ${subscribed ? 1 : 0} WHERE unsubscribe_token = ?`,
      [token]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send('Tuntematon linkki');
    }

    const [rows] = await db.execute(
      'SELECT first_name FROM members WHERE unsubscribe_token = ?',
      [token]
    );

    res.status(200).json({ subscribed, first_name: rows[0]?.first_name || null });
  } catch (err) {
    console.error('Error changing competition email subscription:', err);
    res.status(500).send('Error changing subscription');
  }
};

router.post('/unsubscribe', (req, res) => setCompetitionEmails(req, res, false));
router.post('/resubscribe', (req, res) => setCompetitionEmails(req, res, true));

// Public endpoint for announcements shown on the site.
// Only published announcements that have not expired are visible; drafts and
// past meetings disappear on their own so the front page needs no tidying.
router.get('/announcements', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, type, title, body, meeting_at, location, published_at
       FROM announcements
       WHERE published_at IS NOT NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY published_at DESC`
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching announcements:', err);
    res.status(500).send('Error fetching announcements');
  }
});

// Export both router and submissions array so admin routes can access it
module.exports = { router };
