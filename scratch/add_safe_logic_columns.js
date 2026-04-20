const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function updateSchema() {
  console.log('🔄 Updating Tournaments table schema...');

  const sqlCommands = [
    'ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS next_created BOOLEAN DEFAULT FALSE;',
    'ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS live_lobby_ends_at TIMESTAMPTZ;'
  ];

  for (const sql of sqlCommands) {
    const { error } = await supabase.rpc('execute_sql', { sql });
    if (error) {
      console.error(`❌ Error executing SQL: ${sql}`);
      console.error(error.message);
      console.log('Tip: Make sure the "execute_sql" RPC exists in your Supabase database.');
    } else {
      console.log(`✅ Executed: ${sql}`);
    }
  }

  console.log('🏁 Schema update complete!');
}

updateSchema();
