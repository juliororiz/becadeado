
CREATE SEQUENCE public.room_number_seq START 1;

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number bigint NOT NULL DEFAULT nextval('public.room_number_seq'),
  digits int,
  status text NOT NULL DEFAULT 'waiting', -- waiting | setup | playing | finished | ended
  creator_id uuid NOT NULL,
  creator_name text NOT NULL,
  creator_secret text,
  joiner_id uuid,
  joiner_name text,
  joiner_secret text,
  current_turn uuid,
  winner_id uuid,
  creator_score int NOT NULL DEFAULT 0,
  joiner_score int NOT NULL DEFAULT 0,
  round int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE public.room_number_seq OWNED BY public.rooms.room_number;

CREATE TABLE public.guesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round int NOT NULL,
  player_id uuid NOT NULL,
  position int NOT NULL,
  digit int NOT NULL,
  feedback text NOT NULL, -- correct | lower | higher
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guesses_room_idx ON public.guesses(room_id, round);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guesses TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
GRANT ALL ON public.guesses TO service_role;
GRANT USAGE ON SEQUENCE public.room_number_seq TO anon, authenticated, service_role;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms_all" ON public.rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "guesses_all" ON public.guesses FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.guesses;

ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.guesses REPLICA IDENTITY FULL;
