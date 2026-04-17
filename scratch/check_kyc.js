const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkKYC() {
  const { data, error } = await supabase.from('kyc_requests').select('*');
  if (error) {
    console.error("Error fetching KYC requests:", error);
  } else {
    console.log("KYC Requests count:", data.length);
    console.log("KYC Requests data:", JSON.stringify(data, null, 2));
  }
}

checkKYC();
