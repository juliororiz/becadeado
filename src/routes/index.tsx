import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Plus, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPlayerId } from "@/lib/player";
import { generateRoomCode } from "@/lib/roomCode";
import { toast } from "sonner";
import { Toaster } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Jogo do Cadeado — Adivinhe o número secreto" },
      {
        name: "description",
        content:
          "Jogo do Cadeado online para 2 jogadores. Crie uma sala, convide um amigo e tente descobrir o número secreto dígito a dígito.",
      },
      { property: "og:title", content: "Jogo do Cadeado" },
      { property: "og:description", content: "Adivinhe o número secreto do seu adversário, dígito a dígito." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    getPlayerId();
  }, []);

  async function createRoom() {
    if (!name.trim()) return toast.error("Digite seu nome");
    setCreating(true);
    const playerId = getPlayerId();
    const trimmedName = name.trim();

    let lastError: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode(trimmedName);
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          id: code,
          creator_id: playerId,
          creator_name: trimmedName,
          status: "waiting",
        } as never)
        .select()
        .single();
      if (!error && data) {
        setCreating(false);
        const roomId = (data as { id: string }).id;
        localStorage.setItem(`cadeado_name_${roomId}`, trimmedName);
        navigate({ to: "/room/$id", params: { id: roomId } });
        return;
      }
      lastError = error;
      if (error?.code !== "23505") break; // only retry on code collision
    }
    setCreating(false);
    toast.error(lastError?.message ?? "Erro ao criar sala");
  }

  async function joinRoom() {
    if (!name.trim()) return toast.error("Digite seu nome");
    if (!joinId.trim()) return toast.error("Digite o ID da sala");
    setJoining(true);
    localStorage.setItem(`cadeado_pending_name`, name.trim());
    navigate({ to: "/room/$id", params: { id: joinId.trim().toUpperCase() } });
    setJoining(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <Toaster theme="light" position="top-center" richColors />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -left-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl animate-float-blob"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-16 w-80 h-80 rounded-full bg-grape/20 blur-3xl animate-float-blob"
        style={{ animationDelay: "1.2s" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 right-6 w-40 h-40 rounded-full bg-success/20 blur-3xl animate-float-blob"
        style={{ animationDelay: "2.4s" }}
      />
      <div className="w-full max-w-md relative">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-primary/15 border-2 border-primary/30 flex items-center justify-center mb-4 shadow-glow animate-bounce-in">
            <Lock className="w-10 h-10 text-primary" strokeWidth={2.2} />
          </div>
          <h1 className="text-4xl font-display font-extrabold tracking-tight text-foreground">
            Jogo do{" "}
            <span className="bg-gradient-to-r from-primary to-grape bg-clip-text text-transparent">
              Cadeado
            </span>
          </h1>
          <p className="text-muted-foreground text-sm mt-2 text-center">
            Adivinhe o número secreto do seu adversário, dígito a dígito.
          </p>
        </div>

        <div className="rounded-2xl border-2 border-border bg-card p-6 space-y-5 shadow-card">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Seu nome
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 24))}
              placeholder="Ex.: João"
              className="mt-2 w-full h-12 px-4 rounded-xl bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition"
            />
          </div>

          <button
            onClick={createRoom}
            disabled={creating}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:brightness-110 active:brightness-95 transition disabled:opacity-50"
          >
            <Plus className="w-5 h-5" />
            {creating ? "Criando..." : "Criar sala"}
          </button>

          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">ou</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Código da sala
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={joinId}
                onChange={(e) => setJoinId(e.target.value.trim().toUpperCase().slice(0, 8))}
                placeholder="Ex.: J482910O"
                className="flex-1 min-w-0 h-12 px-4 rounded-xl bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition font-display font-bold tracking-widest text-sm"
              />
              <button
                onClick={joinRoom}
                disabled={joining}
                className="h-12 px-5 rounded-xl bg-secondary text-secondary-foreground font-semibold flex items-center gap-2 hover:brightness-110 transition disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" /> Entrar
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          2 jogadores por sala · sem cadastro
        </p>
      </div>
    </div>
  );
}
