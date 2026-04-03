import 'dotenv/config';
import app from './app.js';

const PORT = Number(process.env.PORT) || 5000;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

export default app;
