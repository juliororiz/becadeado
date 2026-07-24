import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Plus, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPlayerId } from "@/lib/player";
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
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        creator_id: playerId,
        creator_name: name.trim(),
        status: "waiting",
      } as never)
      .select()
      .single();
    setCreating(false);
    if (error || !data) return toast.error(error?.message ?? "Erro ao criar sala");
    localStorage.setItem(`cadeado_name_${(data as { id: string }).id}`, name.trim());
    navigate({ to: "/room/$id", params: { id: (data as { id: string }).id } });
  }

  async function joinRoom() {
    if (!name.trim()) return toast.error("Digite seu nome");
    if (!joinId.trim()) return toast.error("Digite o ID da sala");
    setJoining(true);
    localStorage.setItem(`cadeado_pending_name`, name.trim());
    navigate({ to: "/room/$id", params: { id: joinId.trim() } });
    setJoining(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Toaster theme="dark" position="top-center" richColors />
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-4 shadow-glow">
            <Lock className="w-10 h-10 text-primary" strokeWidth={2.2} />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-foreground">
            Jogo do <span className="text-primary">Cadeado</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-2 text-center">
            Adivinhe o número secreto do seu adversário, dígito a dígito.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-5 shadow-card">
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
              ID da sala
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={joinId}
                onChange={(e) => setJoinId(e.target.value.trim())}
                placeholder="cole o ID aqui"
                className="flex-1 h-12 px-4 rounded-xl bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition font-mono text-sm"
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
