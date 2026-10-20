const mongoose = require('mongoose');

/**
 * Serverless-safe cached MongoDB connection pool.
 * Reuses active socket connections across warm Vercel Function invocations
 * and persistent Node.js servers on Render.
 */
let cached = global._mongooseConnectionCache;
if (!cached) {
  cached = global._mongooseConnectionCache = { conn: null, promise: null };
}

async function connectToDatabase() {
  const uri = process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('your_mongodb')
    ? process.env.MONGODB_URI
    : process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI / MONGO_URI environment variable is not set. Run via Infisical (`infisical run -- npm start`) or configure .env.');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      dbName: process.env.MONGODB_DB_NAME || 'vasool',
    };
    cached.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}

module.exports = { connectToDatabase };
