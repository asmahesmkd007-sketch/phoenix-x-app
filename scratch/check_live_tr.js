const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data: tourneys } = await supabase.from('tournaments').select('*').eq('status', 'live');
  console.log('Live Tournaments in DB:', tourneys.length);
  tourneys.forEach(t => {
    console.log(`TR-${t.tr_id}: status=${t.status}, phase=${t.phase}, live_lobby_ends_at=${t.live_lobby_ends_at}`);
  });
}
check();
