-- Public leaderboard view: shows who's registered for a tournament, but
-- masks per-player stats (tiebreaker, points, ranks) while the tournament
-- is still in 'draft' or 'group_stage_open' (so players can't copy each
-- other's tiebreaker_goals before the deadline).
--
-- This view runs with the owner's privileges (default: security_invoker=off)
-- which bypasses RLS on tournament_entries/players. Masking is enforced at
-- the SQL level via CASE WHEN, not at the UI layer.

CREATE OR REPLACE VIEW public.tournament_leaderboard AS
SELECT
  te.id AS entry_id,
  te.tournament_id,
  te.player_id,
  p.display_name,
  p.nickname,
  p.avatar_url,
  CASE WHEN t.status NOT IN ('draft', 'group_stage_open')
       THEN te.tiebreaker_goals END    AS tiebreaker_goals,
  CASE WHEN t.status NOT IN ('draft', 'group_stage_open')
       THEN te.group_stage_points END  AS group_stage_points,
  CASE WHEN t.status NOT IN ('draft', 'group_stage_open')
       THEN te.knockout_points END     AS knockout_points,
  CASE WHEN t.status NOT IN ('draft', 'group_stage_open')
       THEN te.total_points END        AS total_points,
  CASE WHEN t.status NOT IN ('draft', 'group_stage_open')
       THEN te.tiebreaker_diff END     AS tiebreaker_diff,
  CASE WHEN t.status NOT IN ('draft', 'group_stage_open')
       THEN te.group_stage_rank END    AS group_stage_rank,
  CASE WHEN t.status NOT IN ('draft', 'group_stage_open')
       THEN te.overall_rank END        AS overall_rank,
  t.status AS tournament_status
FROM public.tournament_entries te
JOIN public.players p     ON p.id = te.player_id
JOIN public.tournaments t ON t.id = te.tournament_id;

GRANT SELECT ON public.tournament_leaderboard TO anon, authenticated;;
