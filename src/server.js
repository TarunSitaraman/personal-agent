require('dotenv').config();
const express = require('express');
const { router: webhookRouter } = require('./whatsapp/webhook');
const { startScheduler } = require('./scheduler/briefs');

const app = express();
app.use(express.json());
app.use('/webhook', webhookRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Personal agent running on port ${PORT}`);
  startScheduler();
});
