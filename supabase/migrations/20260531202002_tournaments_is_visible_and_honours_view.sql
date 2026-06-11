-- 1) Add is_visible column to tournaments (default true so existing rows stay visible)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) Archive euros-2024 (keep its row + honours, just hide it from the public app)
UPDATE public.tournaments SET is_visible = FALSE WHERE slug = 'euros-2024';

-- 3) Tighten SELECT policies so hidden tournaments only resolve for admins.
--    Anon: only visible tournaments.
--    Authenticated: visible OR admin.
DROP POLICY IF EXISTS tournaments_select_anon ON public.tournaments;
CREATE POLICY tournaments_select_anon ON public.tournaments
  FOR SELECT TO anon
  USING (is_visible = true);

DROP POLICY IF EXISTS tournaments_select_authenticated ON public.tournaments;
CREATE POLICY tournaments_select_authenticated ON public.tournaments
  FOR SELECT TO authenticated
  USING (is_visible = true OR is_admin());

-- 4) View that the Honours Board can use to still resolve archived tournaments.
--    Default security_invoker=off means this runs as the view owner and
--    bypasses RLS on tournaments — safe because the view only exposes the
--    fields HonoursBoard needs and only joins honours rows that exist.
CREATE OR REPLACE VIEW public.honours_with_tournament AS
SELECT
  h.id,
  h.tournament_id,
  h.player_id,
  h.prize_type,
  h.prize_amount_gbp,
  h.player_name,
  h.description,
  h.points,
  h.sort_order,
  jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'year', t.year,
    'slug', t.slug,
    'type', t.type,
    'status', t.status,
    'is_visible', t.is_visible
  ) AS tournament,
  CASE WHEN p.id IS NOT NULL THEN
    jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'nickname', p.nickname,
      'avatar_url', p.avatar_url
    )
  ELSE NULL END AS player
FROM public.honours h
JOIN public.tournaments t ON t.id = h.tournament_id
LEFT JOIN public.players p ON p.id = h.player_id;

GRANT SELECT ON public.honours_with_tournament TO anon, authenticated;;
