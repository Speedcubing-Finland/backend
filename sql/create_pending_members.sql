-- Run this SQL in your database to create the pending_members table
CREATE TABLE IF NOT EXISTS pending_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  wca_id VARCHAR(20),
  birth_date DATE NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
