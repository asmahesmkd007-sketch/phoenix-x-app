const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function cleanupDuplicates() {
    console.log('🧹 Cleaning up duplicate upcoming tournaments...');
    
    // Get all upcoming paid tournaments
    const { data: tournaments, error } = await supabase
        .from('tournaments')
        .select('id, entry_fee, current_players')
        .eq('type', 'paid')
        .eq('status', 'upcoming');

    if (error) {
        console.error('Error fetching tournaments:', error);
        return;
    }

    const feeMap = new Map();
    const toDelete = [];

    for (const t of tournaments) {
        if (!feeMap.has(t.entry_fee)) {
            // Keep the first one we find for each fee
            feeMap.set(t.entry_fee, t.id);
        } else {
            // If we already have one for this fee, and this one has 0 players, delete it
            if (t.current_players === 0) {
                toDelete.push(t.id);
            }
        }
    }

    if (toDelete.length > 0) {
        console.log(`🗑️ Deleting ${toDelete.length} duplicate tournaments:`, toDelete);
        const { error: delError } = await supabase
            .from('tournaments')
            .delete()
            .in('id', toDelete);
        
        if (delError) console.error('Delete error:', delError);
        else console.log('✅ Cleanup complete.');
    } else {
        console.log('✨ No duplicates with 0 players found.');
    }
}

cleanupDuplicates();
