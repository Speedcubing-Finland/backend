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
});

pool.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    process.exit(1); // Exit process if connection fails
  }
  if (connection) connection.release(); // Release the initial connection back to the pool
  console.log('Connected to the database pool');
});

module.exports = pool.promise(); // Export a promise-based pool
