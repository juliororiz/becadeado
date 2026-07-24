-- Switch room ids from opaque UUIDs to short, shareable codes
-- (first letter of the creator's name + 6 random digits + last letter, e.g. "J482910o")
-- generated on the client at room-creation time.

ALTER TABLE public.guesses DROP CONSTRAINT guesses_room_id_fkey;

ALTER TABLE public.rooms ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.rooms ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.guesses ALTER COLUMN room_id TYPE text USING room_id::text;
ALTER TABLE public.guesses
  ADD CONSTRAINT guesses_room_id_fkey FOREIGN KEY (room_id)
  REFERENCES public.rooms(id) ON DELETE CASCADE;
