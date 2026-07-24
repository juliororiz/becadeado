import { supabase } from "@/integrations/supabase/client";

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function isRoriz(name: string | null | undefined): boolean {
  return normalizeName(name ?? "") === "roriz";
}

export async function getPlayerWins(name: string): Promise<number> {
  const key = normalizeName(name);
  if (!key) return 0;
  const { data, error } = await supabase
    .from("player_wins")
    .select("wins")
    .eq("name_key", key)
    .maybeSingle();
  if (error || !data) return 0;
  return data.wins;
}

export async function incrementPlayerWins(name: string): Promise<void> {
  if (!name.trim()) return;
  await supabase.rpc("increment_player_wins", { p_name: name });
}
