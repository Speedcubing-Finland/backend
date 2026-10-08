#!/usr/bin/env node
/**
 * Drains the email queue. Runs from cron on the host, not from the web app.
 *
 * Deliberately small and stateless: it sends the next due batch, prints what
 * happened, and exits. If it is killed or the host throttles, the queue rows
 * keep their state and the next run continues from there.
 *
 * Cron example - every five minutes:
 *   */5 * * * * cd ~/domains/api.speedcubingfinland.fi/public_html && node scripts/process-email-queue.js >> ~/email-queue.log 2>&1
 */
require('dotenv').config();

const { processEmailQueue } = require('../src/services/emailQueueService');

(async () => {
  const started = Date.now();
  try {
    const result = await processEmailQueue();
    console.log(
      `[email-queue] ${new Date().toISOString()} processed=${result.processed} ` +
      `sent=${result.sent} failed=${result.failed} in ${Date.now() - started}ms` +
      (result.reason ? ` reason=${result.reason}` : '')
    );
    process.exit(0);
  } catch (error) {
    console.error(`[email-queue] ${new Date().toISOString()} run failed:`, error.message);
    process.exit(1);
  }
})();
