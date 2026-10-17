require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { authRouter } = require('./routes/auth');
const { splitsRouter } = require('./routes/splits');
const { connectToDatabase } = require('./lib/mongodb');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check & Infisical/MongoDB status endpoint
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    const uri = process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('your_mongodb')
      ? process.env.MONGODB_URI
      : process.env.MONGO_URI;
    if (uri) {
      await connectToDatabase();
      dbStatus = 'connected';
    } else {
      dbStatus = 'missing_mongodb_uri';
    }
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  res.status(200).json({
    service: 'vasool-splits-web-app',
    status: 'ok',
    version: '2.0.0',
    mongodb: dbStatus,
    googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    infisicalConfigured: Boolean(process.env.MONGO_URI || process.env.MONGODB_URI),
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRouter);
app.use('/api', splitsRouter);

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  connectToDatabase()
    .then(() => {
      console.log('[Vasool Splits] Connected to MongoDB Atlas');
    })
    .catch((err) => {
      console.warn('[Vasool Splits] MongoDB connection deferred or offline:', err.message);
    })
    .finally(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Vasool Splits] Server listening on http://0.0.0.0:${PORT}`);
      });
    });
}

module.exports = app;
