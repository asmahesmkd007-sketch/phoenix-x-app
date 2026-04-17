const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function testStorage() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error("Error listing buckets:", error);
    return;
  }
  console.log("Buckets:", data.map(b => b.name));

  const kycBucket = data.find(b => b.name === 'kyc-documents');
  if (!kycBucket) {
    console.log("Creating bucket kyc-documents...");
    const { data: createData, error: createError } = await supabase.storage.createBucket('kyc-documents', { public: false });
    if (createError) {
      console.error("Error creating bucket:", createError);
    } else {
      console.log("Bucket created:", createData);
    }
  } else {
    console.log("Bucket already exists.");
  }
}

testStorage();
