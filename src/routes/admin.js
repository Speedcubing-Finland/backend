
const express = require('express');
const db = require('../db'); // Ensure the path is correct
const router = express.Router();

let submissions = []; // Temporary storage for submissions

// Endpoint to handle form submissions
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
      res.status(200).send('Submission received successfully');
    } catch (err) {
      console.error('Error checking database or handling submission:', err);
      res.status(500).send('Error checking for duplicate email or saving submission.');
    }
  });
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

module.exports = router;
