import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/qurbani';

const g = globalThis;
if (!g.__qurbaniMongoose) {
  g.__qurbaniMongoose = { conn: null, promise: null };
}

/**
 * Cached connection for serverless (Vercel): reuse across invocations when possible.
 */
export async function connectDB() {
  const cache = g.__qurbaniMongoose;
  if (cache.conn) {
    return cache.conn;
  }
  if (!cache.promise) {
    cache.promise = mongoose.connect(uri);
  }
  try {
    await cache.promise;
    cache.conn = mongoose.connection;
  } catch (e) {
    cache.promise = null;
    throw e;
  }
  return cache.conn;
}
