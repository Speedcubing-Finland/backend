const express = require('express');
const db = require('../db');
const { sendRegistrationPendingEmail } = require('../services/emailService');
const router = express.Router();

let submissions = []; // Temporary storage for submissions

// Public endpoint to handle member registration form submissions
router.post('/submit-member', async (req, res) => {
  const submission = req.body;

  // Validation for required fields
  if (!submission.firstName || !submission.lastName || !submission.city || !submission.email || !submission.birthDate) {
    return res.status(400).send('All required fields must be filled.');
  }

  // Check for duplicate email in submissions (temporary storage)
  const emailExistsInSubmissions = submissions.some((sub) => sub.email === submission.email);
  if (emailExistsInSubmissions) {
    return res.status(400).send('Sähköposti odottaa jo hyväksyntää.');
  }

  try {
    // Check for duplicate email in the database
    const query = `SELECT COUNT(*) AS count FROM members WHERE email = ?`;
    const [results] = await db.execute(query, [submission.email]);
    
    if (results[0].count > 0) {
      return res.status(400).send('Sähköposti on jo rekisteröity.');
    }

    // Add submission to temporary storage
    submissions.push(submission);
    console.log('Submission received:', submission);


    // Send confirmation email (non-blocking)
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

    res.status(200).send('Submission received successfully');
  } catch (err) {
    console.error('Error checking database or handling submission:', err);
    res.status(500).send('Error checking for duplicate email or saving submission.');
  }
});

// Export both router and submissions array so admin routes can access it
module.exports = { router, submissions };
