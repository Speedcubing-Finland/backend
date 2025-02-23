const express = require('express');
const cors = require('cors');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', adminRoutes);

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
