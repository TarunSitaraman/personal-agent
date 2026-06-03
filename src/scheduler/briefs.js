const cron = require('node-cron');
const { generateBrief } = require('../agent/brain');
const { sendMessage } = require('../whatsapp/send');

function startScheduler() {
  const myNumber = process.env.MY_WHATSAPP_NUMBER;

  // 10:00 AM IST — morning brief (Hexaware mode start)
  cron.schedule('0 10 * * 1-5', async () => {
    try {
      const brief = await generateBrief('morning');
      await sendMessage(myNumber, brief);
    } catch (err) {
      console.error('Morning brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 7:00 PM IST — evening switch (SmartResQ mode)
  cron.schedule('0 19 * * *', async () => {
    try {
      const brief = await generateBrief('evening');
      await sendMessage(myNumber, brief);
    } catch (err) {
      console.error('Evening brief error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('Scheduler started — morning (10am) and evening (7pm) briefs active');
}

module.exports = { startScheduler };
