-- ============================================================
-- PHOENIX X — Master Supabase PostgreSQL Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── PROFILES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT UNIQUE NOT NULL,
  full_name       TEXT DEFAULT '',
  phone           TEXT DEFAULT '',
  player_id       TEXT UNIQUE,
  profile_image   TEXT DEFAULT '',
  iq_level        INTEGER DEFAULT 100,
  rank            TEXT DEFAULT 'Bronze' CHECK (rank IN ('Bronze','Silver','Gold','Platinum')),
  kyc_status      TEXT DEFAULT 'not_verified' CHECK (kyc_status IN ('not_verified','pending','verified','approved','rejected')),
  kyc_verified    BOOLEAN DEFAULT FALSE,
  kyc_rejection_reason TEXT DEFAULT '',
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','blocked','banned')),
  is_admin        BOOLEAN DEFAULT FALSE,
  is_online       BOOLEAN DEFAULT FALSE,
  last_seen       TIMESTAMPTZ DEFAULT NOW(),
  total_matches   INTEGER DEFAULT 0,
  wins            INTEGER DEFAULT 0,
  losses          INTEGER DEFAULT 0,
  draws           INTEGER DEFAULT 0,
  win_rate        NUMERIC DEFAULT 0,
  current_streak  INTEGER DEFAULT 0,
  best_streak     INTEGER DEFAULT 0,
  payout_details  JSONB DEFAULT '{}'::jsonb,
  settings        JSONB DEFAULT '{
    "theme": "dark",
    "highlight_moves": true,
    "legal_moves": true,
    "premoves": false,
    "result_animation": true,
    "language": "en",
    "chat_enabled": true,
    "notifications": {"match_found": true, "tournament": true, "friend_request": true},
    "privacy": {"visibility": "public", "online_status": true, "friend_requests": "everyone"},
    "challenge_mode": "auto_accept"
  }'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── WALLETS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  balance         NUMERIC DEFAULT 0 CHECK (balance >= 0),
  total_deposited NUMERIC DEFAULT 0,
  total_withdrawn NUMERIC DEFAULT 0,
  total_won       NUMERIC DEFAULT 0,
  total_spent     NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TOURNAMENTS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tr_id             TEXT UNIQUE, -- Custom ID (TR-1, TR-2...)
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('free','paid')),
  format            TEXT DEFAULT 'standard' CHECK (format IN ('quick','battle','standard')),
  entry_fee         NUMERIC DEFAULT 0,
  timer_type        INTEGER NOT NULL CHECK (timer_type IN (1,3,5,10)),
  max_players       INTEGER DEFAULT 16,
  current_players   INTEGER DEFAULT 0,
  status            TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','full','live','starting','completed','cancelled')),
  phase             TEXT DEFAULT 'upcoming',
  next_created      BOOLEAN DEFAULT FALSE, -- Flag for single replenishment
  live_lobby_ends_at TIMESTAMPTZ,         -- Persistent timer for Live Lobby
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ,
  duration_minutes  INTEGER DEFAULT 30,
  prize_pool        NUMERIC DEFAULT 0,
  prize_first       NUMERIC DEFAULT 0,
  prize_second      NUMERIC DEFAULT 0,
  prize_third       NUMERIC DEFAULT 0,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TOURNAMENT PLAYERS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_players (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score          NUMERIC DEFAULT 0,
  wins           INTEGER DEFAULT 0,
  losses         INTEGER DEFAULT 0,
  draws          INTEGER DEFAULT 0,
  rank           INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'active' CHECK (status IN ('active','eliminated')),
  joined_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

-- ─── MATCHES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player1_id      UUID REFERENCES profiles(id),
  player2_id      UUID REFERENCES profiles(id),
  match_type      TEXT NOT NULL CHECK (match_type IN ('random','friend','room','bot','tournament')),
  timer_type      INTEGER CHECK (timer_type IN (1,3,5,10)),
  tournament_id   UUID,
  round           INTEGER DEFAULT 1,
  result          TEXT DEFAULT 'ongoing' CHECK (result IN ('player1_win','player2_win','draw','ongoing','cancelled')),
  winner_id       UUID REFERENCES profiles(id),
  iq_change_p1    INTEGER DEFAULT 0,
  iq_change_p2    INTEGER DEFAULT 0,
  moves           JSONB DEFAULT '[]'::jsonb,
  room_id         TEXT,
  status          TEXT DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished','cancelled')),
  bot_difficulty  INTEGER,
  flagged_cheating BOOLEAN DEFAULT FALSE,
  cheat_reason    TEXT DEFAULT '',
  start_time      TIMESTAMPTZ,
  end_time        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LEADERBOARD ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_leaderboard (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rank            INTEGER NOT NULL,
  prize           NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

-- ─── KYC REQUESTS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL CHECK (document_type IN ('aadhaar', 'pan', 'passport')),
  name            TEXT NOT NULL,
  dob             DATE NOT NULL,
  aadhaar_number  TEXT,
  pincode         TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  address_line3   TEXT,
  pan_number      TEXT,
  pan_image_url   TEXT,
  passport_number TEXT,
  nationality     TEXT,
  front_image_url TEXT,
  back_image_url  TEXT,
  full_image_url  TEXT,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TRANSACTIONS & WITHDRAWALS ─────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL CHECK (type IN ('deposit','withdraw','tournament_entry','tournament_prize','refund')),
  amount               NUMERIC NOT NULL,
  status               TEXT DEFAULT 'pending' CHECK (status IN ('pending','success','failed','cancelled')),
  razorpay_order_id    TEXT DEFAULT '',
  razorpay_payment_id  TEXT DEFAULT '',
  reference_id         TEXT DEFAULT '',
  description          TEXT DEFAULT '',
  balance_after        NUMERIC DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdraw_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount           NUMERIC NOT NULL CHECK (amount >= 30),
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  payout_details   JSONB DEFAULT '{}'::jsonb,
  queue_position   INTEGER DEFAULT 0,
  rejection_reason TEXT DEFAULT '',
  processed_by     UUID REFERENCES profiles(id),
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── NOTIFICATIONS & SOCIAL ────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  read       BOOLEAN DEFAULT FALSE,
  data       JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sender_id, receiver_id)
);

CREATE TABLE IF NOT EXISTS friends (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user2_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user1_id, user2_id)
);

-- ─── FUNCTIONS & TRIGGERS ──────────────────────────────────

-- Player ID Generator
CREATE OR REPLACE FUNCTION generate_player_id()
RETURNS TRIGGER AS $$
DECLARE seq_val INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO seq_val FROM profiles;
  NEW.player_id := 'PX-' || LPAD(seq_val::TEXT, 6, '0');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER set_player_id BEFORE INSERT ON profiles FOR EACH ROW WHEN (NEW.player_id IS NULL) EXECUTE FUNCTION generate_player_id();

-- Updated_at Auto-update
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER kyc_requests_updated_at BEFORE UPDATE ON kyc_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- TR-ID Generator (TR-1, TR-2...)
CREATE SEQUENCE IF NOT EXISTS tournament_tr_id_seq START 1;
CREATE OR REPLACE FUNCTION generate_tr_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type = 'paid' AND NEW.tr_id IS NULL THEN
    NEW.tr_id := 'TR-' || nextval('tournament_tr_id_seq')::TEXT;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_id_trigger ON tournaments;
CREATE TRIGGER tr_id_trigger BEFORE INSERT ON tournaments FOR EACH ROW EXECUTE FUNCTION generate_tr_id();

-- Notification Limiter (Last 10)
CREATE OR REPLACE FUNCTION limit_user_notifications()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE user_id = NEW.user_id ORDER BY created_at DESC OFFSET 10);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER tr_limit_notifications AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION limit_user_notifications();

-- Increment Tournament Score RPC
CREATE OR REPLACE FUNCTION increment_tournament_score(p_tournament_id UUID, p_user_id UUID, p_score NUMERIC, p_won INTEGER, p_drew INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE tournament_players SET score = score + p_score, wins = wins + p_won, draws = draws + p_drew, losses = losses + CASE WHEN p_won = 0 AND p_drew = 0 THEN 1 ELSE 0 END
  WHERE tournament_id = p_tournament_id AND user_id = p_user_id;
END; $$ LANGUAGE plpgsql;

-- ─── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS matches_player1_idx ON matches(player1_id);
CREATE INDEX IF NOT EXISTS matches_player2_idx ON matches(player2_id);
CREATE INDEX IF NOT EXISTS matches_status_idx ON matches(status);
CREATE INDEX IF NOT EXISTS tp_tournament_idx ON tournament_players(tournament_id);
CREATE INDEX IF NOT EXISTS txn_user_idx ON transactions(user_id);
CREATE INDEX IF NOT EXISTS wr_status_idx ON withdraw_requests(status);
CREATE INDEX IF NOT EXISTS notif_user_idx ON notifications(user_id);

-- ─── ROW LEVEL SECURITY (RLS) ────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tournaments_read" ON tournaments FOR SELECT USING (true);

-- (Other RLS policies omitted for brevity but should be enabled as needed)

SELECT 'PHOENIX X Master Schema Compiled Successfully! 🏆' AS status;
