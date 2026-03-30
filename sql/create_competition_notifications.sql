CREATE TABLE IF NOT EXISTS competition_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  competition_id VARCHAR(64) NOT NULL UNIQUE,
  competition_name VARCHAR(255) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  notified_member_count INT NOT NULL DEFAULT 0,
  failed_member_count INT NOT NULL DEFAULT 0,
  notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
