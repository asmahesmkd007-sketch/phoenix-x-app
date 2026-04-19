const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { supabase } = require('../config/supabase');

async function clearPaidTournaments() {
  console.log('🧹 Clearing upcoming paid tournaments...');
  try {
    const { error } = await supabase.from('tournaments')
      .delete()
      .eq('type', 'paid')
      .eq('status', 'upcoming');
    
    if (error) {
      console.error('Error clearing:', error.message);
    } else {
      console.log('✅ Upcoming paid tournaments cleared.');
    }
  } catch (e) {
    console.error('Script error:', e.message);
  } finally {
    process.exit(0);
  }
}

clearPaidTournaments();
