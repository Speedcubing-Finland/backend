const express = require('express');
const cors = require('cors');
const adminRoutes = require('./routes/admin');

const app = express();


app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://speedcubingfinland.fi',
      'http://localhost:5173'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true
}));

app.use(express.json());

app.use('/api', adminRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

