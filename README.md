# Speedcubing Finland - Backend API

Express.js backend API with JWT authentication for Speedcubing Finland member management.

## 🚀 Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

API runs on `http://localhost:3000`

## 📋 Features

- JWT-based authentication
- BCrypt password hashing
- MySQL database integration
- CORS enabled for specific origins
- Public and protected routes
- Member submission queue system
- Automatic competition notification emails for new Finland WCA competitions

## 🛠️ Tech Stack

- Node.js
- Express 4.21.2
- MySQL2 3.12.0 - Database driver
- jsonwebtoken 9.0.3 - JWT authentication
- bcryptjs 3.0.3 - Password hashing
- dotenv 16.4.7 - Environment variables
- CORS 2.8.5 - Cross-origin requests

## ⚙️ Environment Variables

Create `.env` file:

```env
# Database Configuration
DB_HOST=your_mysql_host
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=your_database_name
DB_PORT=3306

# Server Configuration
PORT=3000

# Admin Authentication
ADMIN_USERNAME=admin

# Generate with: node -e "require('bcryptjs').hash('password', 10, (e,h) => console.log(h))"
ADMIN_PASSWORD_HASH=your_bcrypt_hash_here

# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=your_secret_key_here

# Competition Notification Automation (optional)
COMPETITION_NOTIFY_ENABLED=true
COMPETITION_NOTIFY_INTERVAL_HOURS=6
COMPETITION_NOTIFY_START_DELAY_MS=30000
COMPETITION_NOTIFY_BATCH_SIZE=15
COMPETITION_NOTIFY_SEED_EXISTING=true
```

### Generate Credentials

**Password Hash:**
```bash
node -e "require('bcryptjs').hash('YourPassword', 10, (e,h) => console.log(h))"
```

**JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 📁 Project Structure

```
src/
├── routes/
│   ├── admin.js      # Protected admin endpoints
│   └── public.js     # Public endpoints (no auth)
├── middleware/
│   └── auth.js       # JWT verification middleware
├── db.js             # MySQL connection pool
└── index.js          # Express app setup
```

## 🔐 API Endpoints

### Public Endpoints (No Auth Required)

#### Submit Member Application
```http
POST /api/submit-member
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "city": "Helsinki",
  "birthDate": "1990-01-01",
  "wcaId": "2023DOEJ01"
}
```

#### Admin Login
```http
POST /api/admin/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your_password"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "username": "admin",
  "expiresIn": "24h"
}
```

### Protected Endpoints (JWT Required)

Include JWT token in all requests:
```http
Authorization: Bearer <your_jwt_token>
```

#### Get Pending Submissions
```http
GET /api/admin/submissions

Response:
[
  {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "city": "Helsinki",
    "birthDate": "1990-01-01",
    "wcaId": "2023DOEJ01"
  }
]
```

#### Approve Submission
```http
POST /api/admin/approve
Content-Type: application/json

{
  "index": 0  // Index in submissions array
}
```

Moves submission from queue to `members` table.

#### Reject Submission
```http
POST /api/admin/reject
Content-Type: application/json

{
  "index": 0
}
```

Removes submission from queue.

#### Get All Members
```http
GET /api/admin/members

Response:
[
  {
    "wca_id": "2023DOEJ01",
    "email": "john@example.com",
    "first_name": "John",
    "last_name": "Doe"
  }
]
```

#### Manually Trigger New-Competition Email Check
```http
POST /api/admin/notify-competitions

Response:
{
  "status": "ok",
  "newCompetitions": 1,
  "recipients": 154,
  "sent": 154,
  "failed": 0
}
```

#### Send Single Preview Competition Email
```http
POST /api/admin/notify-competitions-preview
Content-Type: application/json

{
  "email": "you@example.com",
  "competitionId": "KirkkonummiKuutionv%C3%A4%C3%A4ntely2026" // optional
}
```

If `competitionId` is omitted, the first upcoming Finland competition is used.

## 🗄️ Database Schema

```sql
CREATE TABLE members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  city VARCHAR(100) NOT NULL,
  birth_date DATE NOT NULL,
  wca_id VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE competition_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  competition_id VARCHAR(64) NOT NULL UNIQUE,
  competition_name VARCHAR(255) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  notified_member_count INT NOT NULL DEFAULT 0,
  failed_member_count INT NOT NULL DEFAULT 0,
  notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🔒 Security Features

- **BCrypt Password Hashing** - Passwords never stored in plain text
- **JWT Authentication** - Stateless token-based auth
- **Token Expiration** - Tokens expire after 24 hours
- **CORS Protection** - Only allowed origins can access API
- **SQL Injection Prevention** - Parameterized queries
- **Input Validation** - Required fields validated

## 🚀 Deployment (Render.com)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Update with JWT auth"
   git push
   ```

2. **Configure Environment Variables in Render**
   
   Add all variables from `.env`:
   - `DB_HOST`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_NAME`
   - `DB_PORT`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD_HASH`
   - `JWT_SECRET`
   - `COMPETITION_NOTIFY_ENABLED`
   - `COMPETITION_NOTIFY_INTERVAL_HOURS`
   - `COMPETITION_NOTIFY_START_DELAY_MS`
   - `COMPETITION_NOTIFY_BATCH_SIZE`
   - `COMPETITION_NOTIFY_SEED_EXISTING`

3. **Auto-Deploy**
   
   Render deploys automatically on git push.

## 🧪 Development

### Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start with nodemon (auto-restart)
- `npm test` - Run tests (Jest)

### Adding New Routes

1. **Public routes** - Add to `src/routes/public.js`
2. **Protected routes** - Add to `src/routes/admin.js` (after `router.use(verifyToken)`)

### Middleware Flow

```
Request
  ↓
CORS middleware
  ↓
Express JSON parser
  ↓
Route matching (/api or /api/admin)
  ↓
JWT verification (if /api/admin)
  ↓
Route handler
  ↓
Response
```

## � Changing Admin Password

When you need to change the admin password:

**Option 1: Node.js REPL (Recommended)**
```bash
cd backend
node
```
In Node REPL:
```javascript
const bcrypt = require('bcryptjs');
bcrypt.hash('YourNewPassword123', 10).then(hash => console.log(hash));
```

**Option 2: One-Line Command**
```bash
node -e "require('bcryptjs').hash('NewPassword', 10).then(console.log)"
```

**Option 3: Online Tool**
Use https://bcrypt-generator.com/ (10 rounds)

**Update Credentials:**
1. Copy the generated hash
2. Update `ADMIN_PASSWORD_HASH` in `.env` file
3. Update `ADMIN_PASSWORD_HASH` in Render.com environment variables
4. Restart backend (if needed)

## �📝 Notes

- Submissions stored in memory (lost on restart) - consider moving to database
- JWT tokens stored in client localStorage
- Password reset not implemented yet
- No rate limiting currently

## 🐛 Troubleshooting

**401 Unauthorized on protected routes:**
- Check JWT token is valid
- Verify token hasn't expired
- Ensure `Authorization: Bearer <token>` header is set

**Database connection errors:**
- Verify MySQL is running
- Check `.env` database credentials
- Ensure database exists

**CORS errors:**
- Add frontend URL to allowed origins in `index.js`

---

For full project documentation, see main [README.md](../README.md)
