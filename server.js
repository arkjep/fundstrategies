require('dotenv').config();
const { createApp } = require('./src/server/app');
const { resolvePort } = require('./src/server/port');

const app = createApp();
const PORT = resolvePort(process.argv, process.env.PORT);

app.listen(PORT, () => {
  console.log(`Fund strategies server running on http://localhost:${PORT}`);
});
