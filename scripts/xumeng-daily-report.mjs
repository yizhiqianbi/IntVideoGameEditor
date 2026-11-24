#!/usr/bin/env node
import { runReport } from './xumeng-daily-report/report.mjs';

const args = process.argv.slice(2);
let date, refresh = false;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && date === undefined && args[i + 1]) date = args[++i];
    else if (args[i] === '--refresh' && !refresh) refresh = true;
    else throw new Error('Usage: node scripts/xumeng-daily-report.mjs [--date YYYY-MM-DD] [--refresh]');
  }
  const result = await runReport({ date, refresh });
  console.log(JSON.stringify(result));
  if (result.status === 'partial' || result.preservedPrevious) process.exitCode = 2;
} catch (error) {
  // CLI errors are local validation/locking errors, never raw provider output.
  console.error(error.message);
  process.exitCode = 1;
}
