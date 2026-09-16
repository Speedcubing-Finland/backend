require('dotenv').config(); // Load environment variables

const mysql = require('mysql2');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306, // Default MySQL port if not provided
  waitForConnections: true,
  connectionLimit: 10, // Maximum number of connections in the pool
  queueLimit: 0, // Unlimited queue
  // Return DATE/DATETIME/TIMESTAMP columns as strings. Converting them to JS
  // Date objects makes the value depend on the timezone of whichever machine
  // runs the backend, which shifts dates by a day between local and Render.
  dateStrings: true,
});

// Verify the pool can reach the database, but do not treat a failure as fatal:
// a transient outage used to exit the process, which left Render serving a dead
// container until someone restarted it by hand.
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to the database:', err.code || err.message);
    return;
  }

  connection.release();
  console.log('Connected to the database pool');
});

module.exports = pool.promise(); // Export a promise-based pool
