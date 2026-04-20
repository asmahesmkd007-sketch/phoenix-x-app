const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');
const envConfig = dotenv.parse(fs.readFileSync('.env'));

const supabase = createClient(envConfig.SUPABASE_URL, envConfig.SUPABASE_SERVICE_KEY);

async function check() {
  const { data: tourneys } = await supabase.from('tournaments').select('tr_id, status, phase').eq('status', 'live');
  console.log(JSON.stringify(tourneys, null, 2));
}
check();
