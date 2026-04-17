const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkWallets() {
  const { data, error } = await supabase.from('wallets').select('*').limit(1);
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Wallet columns:', Object.keys(data[0] || {}));
    console.log('Sample data:', data[0]);
  }
}

checkWallets();
