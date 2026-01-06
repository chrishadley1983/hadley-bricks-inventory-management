import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSyncLogs() {
  console.log('=== Full Sync Audit Logs (last 30) ===\n');

  // Check sync_audit_log table - get all columns
  const { data: logs, error } = await supabase
    .from('sync_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.log('Error fetching sync_audit_log:', error.message);
  } else if (!logs || logs.length === 0) {
    console.log('No sync audit logs found.');
  } else {
    console.log(`Found ${logs.length} sync audit log entries:\n`);
    logs.forEach(log => {
      console.log(JSON.stringify(log, null, 2));
      console.log('---');
    });
  }

  // Get the schema of sync_audit_log
  console.log('\n=== Checking table columns ===\n');
  const { data: sample } = await supabase
    .from('sync_audit_log')
    .select('*')
    .limit(1);

  if (sample && sample[0]) {
    console.log('Columns in sync_audit_log:', Object.keys(sample[0]));
  }
}

checkSyncLogs().catch(console.error);
