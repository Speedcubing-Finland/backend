require('dotenv').config();
const express = require('express');
const cors = require('cors');
const adminRoutes = require('./routes/admin');
const { router: publicRoutes } = require('./routes/public');
const { startCompetitionNotifier } = require('./services/competitionNotifierService');
const { startEmailQueueWorker } = require('./services/emailQueueService');

const app = express();


app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://speedcubingfinland.fi',
      'https://www.speedcubingfinland.fi',
      'http://localhost:3000',
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

// Health check, also used by the test suite
app.get('/', (req, res) => {
  res.send('Hello from Speedcubing Finland backend!');
});

app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 3000;

// Background work must NOT live inside the require.main guard below.
//
// Passenger, which serves this app on Hostinger, does not run this file as
// the main module: it requires the file and serves the exported app itself.
// require.main is therefore the Passenger wrapper, the listen callback never
// fires, and anything started inside it silently never runs in production -
// which is exactly how the email worker and the competition notifier ended up
// dead on the server while working perfectly in tests.
if (process.env.NODE_ENV !== 'test') {
  startCompetitionNotifier();
  startEmailQueueWorker();
}

// Only open a port when started directly (npm start). Requiring the app - as
// the tests do, and as Passenger does - must not bind one.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
