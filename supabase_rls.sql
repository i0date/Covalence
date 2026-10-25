-- =============================================================================
-- COVALENCE — ROW-LEVEL SECURITY PATCH
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================================
-- Fixes: access_log and duo_sessions were publicly readable via the anon key.
-- This script enables RLS on every Covalence table and adds read policies that
-- require authentication. Writes (INSERT) remain open only where the app needs
-- them (visitor name entry, session creation).
-- =============================================================================


-- ── access_log ────────────────────────────────────────────────────────────────
-- Contains visitor-entered names and emails. Must not be readable anonymously.

ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing permissive policy before adding restrictive ones
DROP POLICY IF EXISTS "Allow all access_log"   ON access_log;
DROP POLICY IF EXISTS "Public read access_log"  ON access_log;

-- Only authenticated users (staff) may read the log
CREATE POLICY "Authenticated read access_log"
  ON access_log
  FOR SELECT
  TO authenticated
  USING (true);

-- The app inserts a row when a visitor signs in — keep that open
CREATE POLICY "Anon insert access_log"
  ON access_log
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- No anonymous updates or deletes
-- (no policy = blocked for anon on UPDATE / DELETE by default once RLS is on)


-- ── duo_sessions ──────────────────────────────────────────────────────────────
-- Contains inter-institution coordination sessions. Must not be publicly readable.

ALTER TABLE duo_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all duo_sessions"    ON duo_sessions;
DROP POLICY IF EXISTS "Public read duo_sessions"   ON duo_sessions;

-- Authenticated users may read all sessions (staff joining a Duo session)
CREATE POLICY "Authenticated read duo_sessions"
  ON duo_sessions
  FOR SELECT
  TO authenticated
  USING (true);

-- The app creates sessions and lets participants join — keep inserts open
CREATE POLICY "Anon insert duo_sessions"
  ON duo_sessions
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Participants update the session to post messages — allow anon updates
-- Scope: only rows they can identify by session_id (passed from the app)
CREATE POLICY "Anon update duo_sessions"
  ON duo_sessions
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
-- Note: tighten this to USING (session_id = current_setting('app.session_id', true))
-- once the app sets a session-scoped variable at sign-in.


-- ── cov_cases (if the table exists) ──────────────────────────────────────────

ALTER TABLE IF EXISTS cov_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all cov_cases"   ON cov_cases;
DROP POLICY IF EXISTS "Public read cov_cases"  ON cov_cases;

CREATE POLICY "Authenticated read cov_cases"
  ON cov_cases
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated write cov_cases"
  ON cov_cases
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ── cov_agents (if the table exists) ─────────────────────────────────────────

ALTER TABLE IF EXISTS cov_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all cov_agents"  ON cov_agents;

CREATE POLICY "Authenticated read cov_agents"
  ON cov_agents
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated write cov_agents"
  ON cov_agents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- VERIFICATION — run this after applying the patch to confirm RLS is on
-- =============================================================================
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('access_log', 'duo_sessions', 'cov_cases', 'cov_agents')
ORDER BY tablename;

-- Expected: rls_enabled = true for every row above.
-- =============================================================================
