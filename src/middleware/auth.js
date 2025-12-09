const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token
 * Adds user information to req.user if token is valid
 */
const verifyToken = (req, res, next) => {
  // Get token from Authorization header (format: "Bearer <token>")
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access denied. No token provided.' 
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Add user info to request
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired. Please login again.' 
      });
    }
    return res.status(403).json({ 
      error: 'Invalid token.' 
    });
  }
};

module.exports = verifyToken;
