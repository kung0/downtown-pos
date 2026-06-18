// PM2 config for the live POS (production).
// Runs the compiled build and pins it to port 3001, so `npm run dev`
// (which reads PORT=3000 from .env) can run at the same time without colliding.
// dotenv does not override env vars already set here, so PORT=3001 wins.
module.exports = {
  apps: [
    {
      name: 'downtown-pos',
      script: 'server/dist/index.js',
      cwd: __dirname,
      env: {
        PORT: 3001,
      },
    },
  ],
};
