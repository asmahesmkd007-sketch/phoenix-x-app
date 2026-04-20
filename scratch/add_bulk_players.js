const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const usernames = [
  '@ma_hes', '@m_radha', '@mana_ansn', '@player6540', '@new_new',
  '@new_nrw', '@new_mew', '@nnan_nana', '@phoenix_brothers', '@phoenix_tamilyt',
  '@phoenix_tamil', '@santha_arun', '@phoenix', '@testing', '@mage'
];

async function addPlayersToTournaments() {
  console.log('🔍 Fetching user IDs for usernames (with @)...');
  
  const { data: users, error: uErr } = await supabase
    .from('profiles')
    .select('id, username')
    .in('username', usernames);

  if (uErr) {
    console.error('Error fetching users:', uErr);
    return;
  }

  const foundUsernames = users.map(u => u.username);
  const missing = usernames.filter(u => !foundUsernames.includes(u));
  
  if (missing.length > 0) {
    console.warn('⚠️ Missing users in database:', missing.join(', '));
  }

  if (users.length === 0) {
    console.error('❌ No users found. Aborting.');
    return;
  }

  console.log(`✅ Found ${users.length} users.`);

  console.log('🔍 Fetching all Upcoming 1-min Paid Tournaments...');
  const { data: tourneys, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, tr_id, current_players, max_players')
    .eq('type', 'paid')
    .eq('timer_type', 1)
    .eq('status', 'upcoming');

  if (tErr) {
    console.error('Error fetching tournaments:', tErr);
    return;
  }

  if (!tourneys || tourneys.length === 0) {
    console.warn('⚠️ No upcoming 1-min paid tournaments found.');
    return;
  }

  console.log(`✅ Found ${tourneys.length} tournaments.`);

  for (const t of tourneys) {
    console.log(`🚀 Adding players to ${t.tr_id} (${t.name})...`);
    
    // Filter out users already in this tournament
    const { data: existingPlayers } = await supabase
      .from('tournament_players')
      .select('user_id')
      .eq('tournament_id', t.id);
    
    const existingIds = new Set(existingPlayers?.map(p => p.user_id) || []);
    const usersToAdd = users.filter(u => !existingIds.has(u.id));

    if (usersToAdd.length === 0) {
      console.log(`ℹ️ All players already in ${t.tr_id}.`);
      continue;
    }

    const inserts = usersToAdd.map(u => ({
      tournament_id: t.id,
      user_id: u.id
    }));

    const { error: insErr } = await supabase
      .from('tournament_players')
      .insert(inserts);

    if (insErr) {
      console.error(`❌ Failed to add players to ${t.tr_id}:`, insErr);
    } else {
      const newCount = (existingPlayers?.length || 0) + inserts.length;
      await supabase.from('tournaments').update({ current_players: newCount }).eq('id', t.id);
      console.log(`✅ Added ${inserts.length} players to ${t.tr_id}. New count: ${newCount}/${t.max_players}`);
      
      // If tournament becomes full, trigger the logic (manager should handle it if it's running)
      if (newCount >= t.max_players) {
        console.log(`🔒 ${t.tr_id} is now FULL.`);
        await supabase.from('tournaments').update({ 
          status: 'full', 
          start_time: new Date(Date.now() + 120000).toISOString() 
        }).eq('id', t.id);
      }
    }
  }

  console.log('🏁 Batch player addition complete!');
}

addPlayersToTournaments();
