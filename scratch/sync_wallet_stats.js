const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function syncAllWallets() {
  console.log('🔄 Starting Wallet Stats Synchronization...');
  
  const { data: wallets, error: wErr } = await supabase.from('wallets').select('user_id');
  if (wErr) return console.error('Error fetching wallets:', wErr);

  for (const w of wallets) {
    const userId = w.user_id;
    console.log(`Processing User: ${userId}`);

    const { data: txns, error: tErr } = await supabase
      .from('transactions')
      .select('type, amount, status')
      .eq('user_id', userId)
      .eq('status', 'success');

    if (tErr) {
      console.error(`Error fetching transactions for ${userId}:`, tErr);
      continue;
    }

    let dep = 0, wit = 0, won = 0, spent = 0;

    txns.forEach(t => {
      const amt = Number(t.amount) || 0;
      if (t.type === 'deposit') dep += amt;
      else if (t.type === 'withdraw') wit += amt;
      else if (t.type === 'tournament_prize') won += amt;
      else if (t.type === 'tournament_entry') spent += amt;
    });

    const { error: upErr } = await supabase
      .from('wallets')
      .update({
        total_deposited: dep,
        total_withdrawn: wit,
        total_won: won,
        total_spent: spent
      })
      .eq('user_id', userId);

    if (upErr) console.error(`Failed to update wallet for ${userId}:`, upErr);
    else console.log(`✅ Synced: Dep=${dep}, Wit=${wit}, Won=${won}, Spent=${spent}`);
  }

  console.log('🏁 Synchronization Complete!');
}

syncAllWallets();
