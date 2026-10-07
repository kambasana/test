#!/usr/bin/env node
// Entry point: `npm start`.
import { startOffice } from './office.mjs';

const office = await startOffice().catch((err) => {
  console.error(`Could not start: ${err.message}`);
  process.exit(1);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await office.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
