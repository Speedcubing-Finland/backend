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

## 📝 Notes

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
