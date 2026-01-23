#!/usr/bin/env node
/**
 * Analyze performance logs
 *
 * Usage:
 *   node scripts/analyze-perf.js [--server|--client|--all] [--since=1h|24h|7d]
 *
 * Examples:
 *   node scripts/analyze-perf.js                    # Analyze all logs from last 24h
 *   node scripts/analyze-perf.js --server --since=1h  # Server logs from last hour
 *   node scripts/analyze-perf.js --client           # Client logs from last 24h
 */

const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
const serverLogPath = path.join(logsDir, 'perf-server.jsonl');
const clientLogPath = path.join(logsDir, 'perf-client.jsonl');

// Parse command line args
const args = process.argv.slice(2);
const showServer = args.includes('--server') || args.includes('--all') || (!args.includes('--client'));
const showClient = args.includes('--client') || args.includes('--all') || (!args.includes('--server'));

// Parse --since argument
let sinceMs = 24 * 60 * 60 * 1000; // Default: 24 hours
const sinceArg = args.find(a => a.startsWith('--since='));
if (sinceArg) {
  const value = sinceArg.split('=')[1];
  if (value.endsWith('h')) {
    sinceMs = parseInt(value) * 60 * 60 * 1000;
  } else if (value.endsWith('d')) {
    sinceMs = parseInt(value) * 24 * 60 * 60 * 1000;
  } else if (value.endsWith('m')) {
    sinceMs = parseInt(value) * 60 * 1000;
  }
}

const sinceDate = new Date(Date.now() - sinceMs);

function readLogFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(entry => {
    if (!entry) return false;
    const entryDate = new Date(entry.timestamp);
    return entryDate >= sinceDate;
  });
}

function analyzeEntries(entries, source) {
  if (entries.length === 0) {
    console.log(`\nNo ${source} entries found.\n`);
    return;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${source.toUpperCase()} PERFORMANCE ANALYSIS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Entries: ${entries.length} | Since: ${sinceDate.toISOString()}\n`);

  // Group by scope
  const byScope = {};
  entries.forEach(entry => {
    if (!byScope[entry.scope]) {
      byScope[entry.scope] = [];
    }
    byScope[entry.scope].push(entry);
  });

  // Calculate stats per scope
  const scopeStats = Object.entries(byScope).map(([scope, scopeEntries]) => {
    const durations = scopeEntries
      .filter(e => e.type === 'end' || e.label === 'TOTAL')
      .map(e => e.durationMs);

    if (durations.length === 0) {
      return { scope, count: scopeEntries.length, avg: 0, min: 0, max: 0, p95: 0 };
    }

    durations.sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);
    const avg = sum / durations.length;
    const min = durations[0];
    const max = durations[durations.length - 1];
    const p95Index = Math.floor(durations.length * 0.95);
    const p95 = durations[p95Index] || max;

    return { scope, count: durations.length, avg, min, max, p95 };
  });

  // Sort by avg duration (slowest first)
  scopeStats.sort((a, b) => b.avg - a.avg);

  // Print table
  console.log('Scope'.padEnd(50) + 'Count'.padStart(8) + 'Avg'.padStart(10) + 'Min'.padStart(10) + 'Max'.padStart(10) + 'P95'.padStart(10));
  console.log('-'.repeat(98));

  scopeStats.forEach(({ scope, count, avg, min, max, p95 }) => {
    if (count === 0) return;
    console.log(
      scope.substring(0, 49).padEnd(50) +
      count.toString().padStart(8) +
      `${avg.toFixed(0)}ms`.padStart(10) +
      `${min.toFixed(0)}ms`.padStart(10) +
      `${max.toFixed(0)}ms`.padStart(10) +
      `${p95.toFixed(0)}ms`.padStart(10)
    );
  });

  // Find slowest individual operations
  console.log('\n--- Slowest Individual Operations ---\n');
  const allWithDuration = entries
    .filter(e => e.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);

  allWithDuration.forEach(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const contextStr = entry.context
      ? ' ' + Object.entries(entry.context).map(([k, v]) => `${k}=${v}`).join(' ')
      : '';
    console.log(`${entry.durationMs.toFixed(0).padStart(6)}ms | ${time} | [${entry.scope}] ${entry.label}${contextStr}`);
  });
}

// Main
console.log('\nPerformance Log Analysis');
console.log(`Time range: Since ${sinceDate.toLocaleString()}\n`);

if (showServer) {
  const serverEntries = readLogFile(serverLogPath);
  analyzeEntries(serverEntries, 'Server');
}

if (showClient) {
  const clientEntries = readLogFile(clientLogPath);
  analyzeEntries(clientEntries, 'Client');
}

console.log('\n');
