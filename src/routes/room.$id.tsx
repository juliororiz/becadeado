import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Lock, LockOpen, Copy, Check, Share2, ArrowLeft, Sparkles, PartyPopper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPlayerId } from "@/lib/player";
import {
  playCorrectSound,
  playWinSound,
  playOpponentCorrectSound,
  playTomatoSplatSound,
} from "@/lib/sound";
import { vibrate } from "@/lib/haptics";
import { isRoriz, getPlayerWins, incrementPlayerWins } from "@/lib/wins";
import { toast, Toaster } from "sonner";

export const Route = createFileRoute("/room/$id")({
  head: () => ({
    meta: [
      { title: "Sala — Jogo do Cadeado" },
      { name: "description", content: "Sala de partida do Jogo do Cadeado." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

type Room = {
  id: string;
  room_number: number;
  digits: number | null;
  status: "waiting" | "setup" | "playing" | "finished" | "ended";
  creator_id: string;
  creator_name: string;
  creator_secret: string | null;
  joiner_id: string | null;
  joiner_name: string | null;
  joiner_secret: string | null;
  current_turn: string | null;
  winner_id: string | null;
  creator_score: number;
  joiner_score: number;
  round: number;
  created_at: string;
};

// A room link that never gets a 2nd player dies after this long — kept in
// sync with the `expire-waiting-rooms` pg_cron job that sweeps the DB row.
const ROOM_EXPIRY_MS = 5 * 60 * 1000;

function isRoomExpired(r: Pick<Room, "status" | "created_at">): boolean {
  return r.status === "waiting" && Date.now() - new Date(r.created_at).getTime() >= ROOM_EXPIRY_MS;
}

type Guess = {
  id: string;
  room_id: string;
  round: number;
  player_id: string;
  position: number;
  digit: number;
  feedback: "correct" | "lower" | "higher";
  created_at: string;
};

function RoomPage() {
  const { id: roomId } = Route.useParams();
  const navigate = useNavigate();
  const [playerId, setPlayerId] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [opponentGuess, setOpponentGuess] = useState<{
    position: number;
    digit: number;
    correct: boolean;
  } | null>(null);
  const [tomatoHit, setTomatoHit] = useState(false);
  const [myWins, setMyWins] = useState(0);
  const [expired, setExpired] = useState(false);
  const joinAttempted = useRef(false);
  const playerIdRef = useRef("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const id = getPlayerId();
    setPlayerId(id);
    playerIdRef.current = id;
  }, []);

  // Auto-dismiss the opponent guess modal after 2s
  useEffect(() => {
    if (!opponentGuess) return;
    const t = setTimeout(() => setOpponentGuess(null), 2000);
    return () => clearTimeout(t);
  }, [opponentGuess]);

  // Auto-dismiss the tomato splat effect
  useEffect(() => {
    if (!tomatoHit) return;
    const t = setTimeout(() => setTomatoHit(false), 2800);
    return () => clearTimeout(t);
  }, [tomatoHit]);

  // Flip the room to expired the instant it hits 5 minutes without a 2nd
  // player — even if the cron sweep hasn't deleted the row yet.
  useEffect(() => {
    if (!room || room.status !== "waiting") return;
    if (isRoomExpired(room)) {
      setExpired(true);
      return;
    }
    const remaining = new Date(room.created_at).getTime() + ROOM_EXPIRY_MS - Date.now();
    const t = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(t);
  }, [room?.status, room?.created_at]);

  // Track my own win tally — it's what unlocks the tomato (Roriz gets it for free)
  useEffect(() => {
    if (!room || !playerId) return;
    const amICreator = room.creator_id === playerId;
    const myNm = amICreator ? room.creator_name : room.joiner_name;
    if (!myNm) {
      setMyWins(0);
      return;
    }
    let cancelled = false;
    getPlayerWins(myNm).then((w) => {
      if (!cancelled) setMyWins(w);
    });
    return () => {
      cancelled = true;
    };
  }, [room?.creator_id, room?.joiner_id, room?.creator_name, room?.joiner_name, playerId]);

  // Initial load + realtime
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setRoom(data as unknown as Room);
      const { data: gs } = await supabase
        .from("guesses")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      if (!cancelled) setGuesses(((gs as unknown as Guess[]) ?? []));
      setLoading(false);
    })();

    const ch = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            // Only ever happens via the expire-waiting-rooms cron sweep.
            setExpired(true);
            return;
          }
          if (payload.new) setRoom(payload.new as Room);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "guesses", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const inserted = payload.new as Guess;
          setGuesses((prev) => [...prev, inserted]);
          if (inserted.player_id !== playerIdRef.current) {
            const correct = inserted.feedback === "correct";
            setOpponentGuess({ position: inserted.position, digit: inserted.digit, correct });
            if (correct) {
              vibrate(20);
              playOpponentCorrectSound();
            }
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "guesses", filter: `room_id=eq.${roomId}` },
        () => {
          // easier: refetch on delete (used for new round)
          supabase
            .from("guesses")
            .select("*")
            .eq("room_id", roomId)
            .order("created_at", { ascending: true })
            .then(({ data }) => setGuesses(((data as unknown as Guess[]) ?? [])));
        },
      )
      .on("broadcast", { event: "tomato" }, () => {
        setTomatoHit(true);
        playTomatoSplatSound();
        vibrate([30, 40, 30, 50, 140]);
      })
      .subscribe();
    channelRef.current = ch;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [roomId]);

  function throwTomato() {
    const eligible = isRoriz(myName) || myWins >= 10;
    if (!eligible) {
      toast.error("Você precisa ter 10 ou mais vitórias para jogar tomate! 🍅");
      return;
    }
    channelRef.current?.send({ type: "broadcast", event: "tomato", payload: {} });
    toast.success("Tomate jogado! 🍅");
  }

  function bumpMyWins() {
    setMyWins((w) => w + 1);
  }

  // Auto-join if we came from home with a pending name and slot is open
  useEffect(() => {
    if (!room || !playerId || joinAttempted.current || expired) return;
    if (room.creator_id === playerId) return;
    if (room.joiner_id === playerId) return;
    if (room.joiner_id) return; // full
    joinAttempted.current = true;
    const pending = localStorage.getItem("cadeado_pending_name");
    if (pending) {
      localStorage.removeItem("cadeado_pending_name");
      joinAs(pending);
    }
    // else: NameGate will render for user to type their name
  }, [room, playerId, expired]);

  async function joinAs(name: string) {
    if (!room) return;
    const { error } = await supabase
      .from("rooms")
      .update({
        joiner_id: playerId,
        joiner_name: name,
        status: "setup",
      } as never)
      .eq("id", room.id)
      .is("joiner_id", null);
    if (error) toast.error(error.message);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <p className="text-foreground text-lg font-bold mb-1">Este link expirou ⏱️</p>
          <p className="text-muted-foreground text-sm mb-4">
            A sala não foi completada por dois jogadores em 5 minutos e não está mais disponível.
          </p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="px-5 h-11 rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (notFound || !room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-foreground mb-4">Sala não encontrada. O link pode ter expirado.</p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="px-5 h-11 rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const isCreator = room.creator_id === playerId;
  const isJoiner = room.joiner_id === playerId;
  const isPlayer = isCreator || isJoiner;
  const myName = isCreator ? room.creator_name : room.joiner_name;
  const canShowTomatoButton = !!room.joiner_id;

  // Spectator or joining
  if (!isPlayer) {
    if (room.joiner_id) {
      return (
        <Shell>
          <div className="text-center py-10">
            <p className="text-foreground text-lg">Esta sala já está cheia.</p>
            <button
              onClick={() => navigate({ to: "/" })}
              className="mt-4 px-5 h-11 rounded-xl bg-primary text-primary-foreground font-semibold"
            >
              Voltar
            </button>
          </div>
        </Shell>
      );
    }
    return <NameGate roomNumber={room.room_number} onSubmit={joinAs} />;
  }

  return (
    <Shell shake={tomatoHit}>
      {tomatoHit && <TomatoSplat />}
      {opponentGuess && (
        <OpponentGuessModal
          text={
            opponentGuess.correct
              ? `O adversário acertou o número ${opponentGuess.digit}!`
              : `O adversário acha que o ${ordinal(opponentGuess.position + 1)} número é ${opponentGuess.digit}`
          }
          correct={opponentGuess.correct}
        />
      )}
      {canShowTomatoButton && <TomatoButton onThrow={throwTomato} />}
      <Header room={room} playerId={playerId} onLeave={() => navigate({ to: "/" })} />
      <ScoreBar room={room} playerId={playerId} />
      {room.status === "waiting" && <WaitingView room={room} />}
      {room.status === "setup" && (
        <SetupView room={room} isCreator={isCreator} playerId={playerId} />
      )}
      {(room.status === "playing" || room.status === "finished") && (
        <PlayView
          room={room}
          playerId={playerId}
          guesses={guesses}
          isCreator={isCreator}
          onWin={bumpMyWins}
        />
      )}
      {room.status === "ended" && (
        <div className="text-center py-10">
          <p className="text-lg text-foreground">O jogo foi encerrado.</p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="mt-4 px-5 h-11 rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            Voltar ao início
          </button>
        </div>
      )}
    </Shell>
  );
}

function OpponentGuessModal({ text, correct }: { text: string; correct: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-24 px-4 pointer-events-none">
      <div
        className={`pointer-events-auto w-full max-w-xs sm:max-w-sm rounded-2xl border-2 backdrop-blur px-4 sm:px-5 py-3 sm:py-4 shadow-card text-center animate-bounce-in ${
          correct
            ? "border-success bg-success/15 text-success"
            : "border-primary/40 bg-card/95 text-foreground"
        }`}
      >
        <p className="text-sm font-extrabold">
          {correct ? "🎯 " : ""}
          {text}
        </p>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = [
  "oklch(0.66 0.24 355)", // bubblegum
  "oklch(0.75 0.18 85)", // sunshine
  "oklch(0.62 0.11 220)", // sky
  "oklch(0.56 0.24 305)", // grape
  "oklch(0.68 0.19 155)", // mint
];

function Confetti({ count = 28 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.35,
        duration: 0.9 + Math.random() * 0.6,
        size: 6 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rounded: Math.random() > 0.5,
      })),
    [count],
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 animate-confetti-fall"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.rounded ? "9999px" : "3px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

function TomatoButton({ onThrow }: { onThrow: () => void }) {
  return (
    <button
      onClick={onThrow}
      aria-label="Jogar tomate no adversário"
      title="Jogar tomate no adversário"
      className="fixed bottom-5 right-5 z-40 w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-red-700 border-4 border-white shadow-card flex items-center justify-center text-3xl hover:scale-110 active:scale-95 transition-transform animate-bounce-in"
    >
      🍅
    </button>
  );
}

function TomatoSplat() {
  const splats = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 40 + Math.random() * 90,
        delay: Math.random() * 0.15,
      })),
    [],
  );
  const drips = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: i,
        left: 4 + i * 9.5 + Math.random() * 5,
        width: 16 + Math.random() * 26,
        height: 140 + Math.random() * 180,
        delay: Math.random() * 0.3,
      })),
    [],
  );
  return (
    <div
      className="fixed inset-0 z-[100] pointer-events-none overflow-hidden animate-tomato-fade"
      aria-hidden
    >
      <div className="absolute inset-0 bg-gradient-to-b from-red-600/85 via-red-700/80 to-red-900/75 animate-tomato-impact" />

      {splats.map((s) => (
        <span
          key={s.id}
          className="absolute rounded-full bg-red-800/60 blur-[2px] animate-tomato-splat-pop"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size * (0.7 + Math.random() * 0.4),
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}

      {splats.slice(0, 8).map((s) => (
        <span
          key={`seed-${s.id}`}
          className="absolute w-2 h-2 rounded-full bg-yellow-300/80 animate-tomato-splat-pop"
          style={{
            left: `${(s.left + 15) % 100}%`,
            top: `${(s.top + 20) % 100}%`,
            animationDelay: `${s.delay + 0.1}s`,
          }}
        />
      ))}

      {drips.map((d) => (
        <span
          key={d.id}
          className="absolute top-0 bg-gradient-to-b from-red-600 to-red-800/90 animate-tomato-drip"
          style={
            {
              left: `${d.left}%`,
              width: d.width,
              borderRadius: "0 0 50% 50% / 0 0 65% 65%",
              animationDelay: `${d.delay}s`,
              "--drip-h": `${d.height}px`,
            } as CSSProperties
          }
        />
      ))}

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[7rem] drop-shadow-[0_6px_20px_rgba(0,0,0,0.5)] animate-tomato-splat-pop">
          🍅💥
        </span>
      </div>
    </div>
  );
}

function Shell({ children, shake = false }: { children: React.ReactNode; shake?: boolean }) {
  return (
    <div
      className={`min-h-screen bg-background text-foreground relative overflow-x-hidden ${shake ? "animate-screen-shake" : ""}`}
    >
      <Toaster theme="light" position="top-center" richColors />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 -left-16 w-72 h-72 rounded-full bg-primary/20 blur-3xl animate-float-blob"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-24 -right-16 w-72 h-72 rounded-full bg-accent/20 blur-3xl animate-float-blob"
        style={{ animationDelay: "1.5s" }}
      />
      <div className="max-w-2xl mx-auto p-3 sm:p-6 md:p-8 relative">{children}</div>
    </div>
  );
}

function Header({ room, playerId, onLeave }: { room: Room; playerId: string; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const isCreator = room.creator_id === playerId;
  const url = typeof window !== "undefined" ? `${window.location.origin}/room/${room.id}` : "";

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Sala ${room.room_number} — Cadeado`, url });
        return;
      }
    } catch {
      /* ignore */
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copiado!");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center justify-between mb-6">
      <button
        onClick={onLeave}
        className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center hover:bg-secondary transition"
        aria-label="Sair"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <Lock className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Sala {room.room_number}</h1>
      </div>
      {isCreator ? (
        <button
          onClick={share}
          className="h-10 px-3 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center gap-2"
        >
          {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
          <span className="text-sm">Convidar</span>
        </button>
      ) : (
        <div className="w-10" />
      )}
    </div>
  );
}

function ScoreBar({ room, playerId }: { room: Room; playerId: string }) {
  const meIsCreator = room.creator_id === playerId;
  const myName = meIsCreator ? room.creator_name : room.joiner_name ?? "Você";
  const opName = meIsCreator ? room.joiner_name ?? "Aguardando..." : room.creator_name;
  const myScore = meIsCreator ? room.creator_score : room.joiner_score;
  const opScore = meIsCreator ? room.joiner_score : room.creator_score;
  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      <PlayerCard name={`${myName} (você)`} score={myScore} accent />
      <PlayerCard name={opName} score={opScore} />
    </div>
  );
}

function PlayerCard({ name, score, accent = false }: { name: string; score: number; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground truncate">{name}</p>
      <p className="text-3xl font-display font-extrabold mt-1 tabular-nums">{score}</p>
    </div>
  );
}

function WaitingView({ room }: { room: Room }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/room/${room.id}` : "";
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(room.created_at).getTime() + ROOM_EXPIRY_MS - Date.now()),
  );

  useEffect(() => {
    const i = setInterval(() => {
      setRemainingMs(Math.max(0, new Date(room.created_at).getTime() + ROOM_EXPIRY_MS - Date.now()));
    }, 1000);
    return () => clearInterval(i);
  }, [room.created_at]);

  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000);

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-6 text-center">
      <div className="animate-pulse w-16 h-16 rounded-2xl bg-primary/15 border-2 border-primary/30 mx-auto flex items-center justify-center mb-4">
        <Lock className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-lg font-bold">Aguardando 2º jogador...</h2>
      <p className="text-sm text-muted-foreground mt-1">Compartilhe o código com seu amigo</p>
      <p className="text-xs text-muted-foreground mt-1">
        O link expira em{" "}
        <span className="font-display font-bold tabular-nums">
          {remainingMin}:{String(remainingSec).padStart(2, "0")}
        </span>
      </p>

      <div className="mt-4 flex items-center justify-center gap-2">
        <span className="text-3xl font-display font-extrabold tracking-[0.15em] text-primary">
          {room.id}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(room.id);
            toast.success("Código copiado!");
          }}
          className="p-2 rounded-lg bg-secondary hover:brightness-110"
          aria-label="Copiar código"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>

      <button
        onClick={() => {
          navigator.clipboard.writeText(url);
          toast.success("Link copiado!");
        }}
        className="mt-3 text-xs text-muted-foreground underline hover:text-foreground"
      >
        ou copiar o link do convite
      </button>
    </div>
  );
}

function NameGate({ roomNumber, onSubmit }: { roomNumber: number; onSubmit: (n: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Shell>
      <div className="max-w-md mx-auto mt-16">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-bold">Entrar na sala {roomNumber}</h2>
          <p className="text-sm text-muted-foreground mt-1">Como você quer ser chamado?</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            placeholder="Seu nome"
            className="mt-4 w-full h-12 px-4 rounded-xl bg-input border border-border focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => name.trim() && onSubmit(name.trim())}
            className="mt-4 w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            Entrar
          </button>
        </div>
      </div>
    </Shell>
  );
}

function SetupView({
  room,
  isCreator,
  playerId,
}: {
  room: Room;
  isCreator: boolean;
  playerId: string;
}) {
  const [digits, setDigits] = useState(room.digits ?? 4);
  const [secret, setSecret] = useState("");
  const mySecret = isCreator ? room.creator_secret : room.joiner_secret;
  const opSecret = isCreator ? room.joiner_secret : room.creator_secret;

  async function chooseDigits() {
    const { error } = await supabase
      .from("rooms")
      .update({ digits } as never)
      .eq("id", room.id);
    if (error) toast.error(error.message);
  }

  async function submitSecret() {
    if (!room.digits) return;
    if (secret.length !== room.digits || !/^\d+$/.test(secret)) {
      return toast.error(`Digite exatamente ${room.digits} algarismos`);
    }
    const patch: Record<string, unknown> = isCreator
      ? { creator_secret: secret }
      : { joiner_secret: secret };
    // If the other secret is already set, move to playing
    if ((isCreator ? room.joiner_secret : room.creator_secret) != null) {
      patch.status = "playing";
      patch.current_turn = room.creator_id; // creator goes first
      patch.winner_id = null;
    }
    const { error } = await supabase.from("rooms").update(patch as never).eq("id", room.id);
    if (error) toast.error(error.message);
    else toast.success("Número secreto salvo!");
  }

  // Step 1: creator picks digit count
  if (room.digits == null) {
    if (!isCreator) {
      return (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-foreground">
            Aguardando <b>{room.creator_name}</b> escolher a quantidade de algarismos...
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-bold">Quantos algarismos?</h2>
        <p className="text-sm text-muted-foreground">De 1 a 10 dígitos.</p>
        <div className="mt-5 flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={10}
            value={digits}
            onChange={(e) => setDigits(Number(e.target.value))}
            className="flex-1 accent-[oklch(0.82_0.16_78)]"
          />
          <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/40 flex items-center justify-center text-3xl font-display font-extrabold text-primary tabular-nums">
            {digits}
          </div>
        </div>
        <button
          onClick={chooseDigits}
          className="mt-5 w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
        >
          Confirmar
        </button>
      </div>
    );
  }

  // Step 2: each player enters secret
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-bold">
        Escolha seu número secreto <span className="text-primary">({room.digits} algarismos)</span>
      </h2>
      <p className="text-sm text-muted-foreground mt-1">
        Seu adversário vai tentar adivinhar dígito a dígito.
      </p>

      {mySecret ? (
        <div className="mt-5 p-4 rounded-xl bg-success/10 border border-success/30 text-center">
          <p className="text-sm text-muted-foreground">Seu número:</p>
          <p className="text-3xl font-display font-extrabold tracking-widest text-success mt-1">
            {mySecret}
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            {opSecret
              ? "Iniciando partida..."
              : `Aguardando ${
                  isCreator ? room.joiner_name : room.creator_name
                } escolher o número...`}
          </p>
        </div>
      ) : (
        <>
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value.replace(/\D/g, "").slice(0, room.digits!))}
            placeholder={"0".repeat(room.digits)}
            inputMode="numeric"
            autoFocus
            className="mt-5 w-full h-16 px-4 rounded-xl bg-input border border-border text-center text-3xl font-display font-bold tracking-widest focus:outline-none focus:border-primary"
          />
          <button
            onClick={submitSecret}
            disabled={secret.length !== room.digits}
            className="mt-4 w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-40"
          >
            Confirmar segredo
          </button>
        </>
      )}
      <p className="text-xs text-muted-foreground mt-3 text-center">
        {playerId ? "" : ""}
      </p>
    </div>
  );
}

function PlayView({
  room,
  playerId,
  guesses,
  isCreator,
  onWin,
}: {
  room: Room;
  playerId: string;
  guesses: Guess[];
  isCreator: boolean;
  onWin: () => void;
}) {
  const digits = room.digits ?? 0;
  const opId = isCreator ? room.joiner_id! : room.creator_id;
  const opSecret = (isCreator ? room.joiner_secret : room.creator_secret) ?? "";
  const mySecret = (isCreator ? room.creator_secret : room.joiner_secret) ?? "";

  const roundGuesses = guesses.filter((g) => g.round === room.round);
  const myGuesses = roundGuesses.filter((g) => g.player_id === playerId);
  const opGuesses = roundGuesses.filter((g) => g.player_id === opId);

  const myBoard = buildBoard(myGuesses, digits);
  const opBoard = buildBoard(opGuesses, digits);

  const myProgress = myBoard.filter((c) => c.known !== null).length;
  const isMyTurn = room.current_turn === playerId && room.status === "playing";
  const [guess, setGuess] = useState<string>("");
  const [celebration, setCelebration] = useState<number | null>(null);
  const winner =
    room.status === "finished"
      ? room.winner_id === room.creator_id
        ? room.creator_name
        : room.joiner_name
      : null;

  useEffect(() => {
    if (celebration === null) return;
    const t = setTimeout(() => setCelebration(null), 1600);
    return () => clearTimeout(t);
  }, [celebration]);

  async function submitGuess() {
    if (!isMyTurn) return;
    if (!/^\d$/.test(guess)) return toast.error("Digite 1 algarismo (0-9)");
    const d = Number(guess);
    const pos = myProgress; // next unknown
    const target = Number(opSecret[pos]);
    const feedback: Guess["feedback"] =
      d === target ? "correct" : d < target ? "higher" : "lower";
    const { error } = await supabase.from("guesses").insert({
      room_id: room.id,
      round: room.round,
      player_id: playerId,
      position: pos,
      digit: d,
      feedback,
    } as never);
    if (error) return toast.error(error.message);
    setGuess("");

    const willWin = feedback === "correct" && pos + 1 === digits;
    if (feedback === "correct") {
      playCorrectSound();
      vibrate(willWin ? [50, 30, 50, 30, 90] : 35);
      if (willWin) playWinSound();
      else setCelebration(d);
    }
    const patch: Record<string, unknown> = willWin
      ? {
          status: "finished",
          winner_id: playerId,
          current_turn: null,
          creator_score: isCreator ? room.creator_score + 1 : room.creator_score,
          joiner_score: isCreator ? room.joiner_score : room.joiner_score + 1,
        }
      : { current_turn: opId };
    await supabase.from("rooms").update(patch as never).eq("id", room.id);
    if (willWin) {
      const myName = isCreator ? room.creator_name : room.joiner_name;
      if (myName) void incrementPlayerWins(myName);
      onWin();
    }
  }

  return (
    <div className="space-y-4">
      {celebration !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none">
          <div className="relative pointer-events-auto overflow-hidden rounded-3xl border-2 border-success bg-card px-8 py-6 shadow-card text-center animate-bounce-in">
            <Confetti count={20} />
            <PartyPopper className="w-8 h-8 text-success mx-auto mb-1" />
            <p className="text-2xl font-display font-extrabold text-success">Acertou!</p>
            <p className="text-sm text-muted-foreground mt-1">
              O dígito era <span className="font-display font-bold text-foreground">{celebration}</span>
            </p>
          </div>
        </div>
      )}

      {room.status === "finished" && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-success bg-success/10 p-5 text-center shadow-glow animate-bounce-in">
          {room.winner_id === playerId && <Confetti />}
          <div className="mx-auto mb-2 w-14 h-14 rounded-2xl bg-success/20 flex items-center justify-center animate-unlock-wiggle">
            <LockOpen className="w-7 h-7 text-success" />
          </div>
          <p className="text-xl font-display font-extrabold text-success">
            {room.winner_id === playerId ? "Você venceu! 🎉" : `${winner} venceu!`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Número do adversário era{" "}
            <span className="font-display font-bold text-foreground">{opSecret}</span>
          </p>
        </div>
      )}

      {/* Your target: opponent's secret you're trying to guess */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">🎯 Descobrir número de {isCreator ? room.joiner_name : room.creator_name}</h3>
          <span className="text-xs text-muted-foreground">
            {myProgress}/{digits}
          </span>
        </div>
        <DigitBoard board={myBoard} />
        <GuessHistory board={myBoard} />
      </div>

      {/* Turn / input */}
      {room.status === "playing" && (
        <div
          className={`rounded-2xl border p-5 ${
            isMyTurn ? "border-primary bg-primary/5 shadow-glow" : "border-border bg-card"
          }`}
        >
          {isMyTurn ? (
            <>
              <p className="text-sm text-muted-foreground">
                Sua vez — adivinhe o <b>{ordinal(myProgress + 1)}</b> algarismo
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={guess}
                  onChange={(e) => setGuess(e.target.value.replace(/\D/g, "").slice(0, 1))}
                  inputMode="numeric"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                  className="w-full h-14 px-4 rounded-xl bg-input border border-border text-center text-2xl font-display font-bold focus:outline-none focus:border-primary"
                  placeholder="?"
                />
                <button
                  onClick={submitGuess}
                  className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-5 h-5" />
                  Confirmar
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-center text-muted-foreground py-3">
              Vez de <b className="text-foreground">
                {room.current_turn === room.creator_id ? room.creator_name : room.joiner_name}
              </b>
              ...
            </p>
          )}
        </div>
      )}

      {/* Opponent's board (against your secret) */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-bold mb-3">
          🔒 Seu número secreto{" "}
          <span className="font-display font-bold text-primary">{mySecret}</span>
        </h3>
        <p className="text-xs text-muted-foreground mb-2">
          Progresso do adversário: {opBoard.filter((c) => c.known !== null).length}/{digits}
        </p>
        <DigitBoard board={opBoard} hideUnknown />
      </div>

      {room.status === "finished" && (
        <NextRoundControls room={room} isCreator={isCreator} />
      )}
    </div>
  );
}

function NextRoundControls({ room, isCreator }: { room: Room; isCreator: boolean }) {
  const [newDigits, setNewDigits] = useState(room.digits ?? 4);

  async function newRound() {
    await supabase.from("guesses").delete().eq("room_id", room.id);
    await supabase
      .from("rooms")
      .update({
        digits: newDigits,
        status: "setup",
        creator_secret: null,
        joiner_secret: null,
        current_turn: null,
        winner_id: null,
        round: room.round + 1,
      } as never)
      .eq("id", room.id);
  }

  async function endGame() {
    await supabase.from("rooms").update({ status: "ended" } as never).eq("id", room.id);
  }

  if (!isCreator) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
        Aguardando {room.creator_name} iniciar a próxima rodada...
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-bold">Nova rodada?</h3>
      <p className="text-sm text-muted-foreground mt-1">Escolha a quantidade de algarismos.</p>
      <div className="mt-4 flex items-center gap-4">
        <input
          type="range"
          min={1}
          max={10}
          value={newDigits}
          onChange={(e) => setNewDigits(Number(e.target.value))}
          className="flex-1 accent-[oklch(0.82_0.16_78)]"
        />
        <div className="w-14 h-14 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center text-2xl font-display font-extrabold text-primary">
          {newDigits}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={newRound}
          className="h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
        >
          Jogar novamente
        </button>
        <button
          onClick={endGame}
          className="h-12 rounded-xl bg-secondary text-secondary-foreground font-semibold"
        >
          Encerrar jogo
        </button>
      </div>
    </div>
  );
}

// -------- helpers --------

type Attempt = { digit: number; feedback: "higher" | "lower" };

type Cell = {
  known: number | null;
  attempts: Attempt[];
};

function buildBoard(playerGuesses: Guess[], digits: number): Cell[] {
  const board: Cell[] = Array.from({ length: digits }, () => ({
    known: null,
    attempts: [],
  }));
  // Sort by created_at
  const sorted = [...playerGuesses].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let pos = 0;
  for (const g of sorted) {
    if (pos >= digits) break;
    const c = board[pos];
    if (g.feedback === "correct") {
      c.known = g.digit;
      pos++;
    } else {
      // "higher": guessed d, real digit is higher. "lower": real digit is lower.
      c.attempts.push({ digit: g.digit, feedback: g.feedback });
    }
  }
  return board;
}

function DigitBoard({ board, hideUnknown = false }: { board: Cell[]; hideUnknown?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {board.map((c, i) => (
        <div
          key={i}
          className={`w-9 h-11 sm:w-12 sm:h-14 rounded-xl border-2 flex items-center justify-center text-lg sm:text-2xl font-display font-bold ${
            c.known !== null
              ? "bg-success/15 border-success text-success animate-tile-flip"
              : "bg-input border-border text-muted-foreground"
          }`}
        >
          {c.known !== null ? c.known : hideUnknown ? "•" : "?"}
        </div>
      ))}
    </div>
  );
}

function GuessHistory({ board }: { board: Cell[] }) {
  const hasAttempts = board.some((c) => c.known === null && c.attempts.length > 0);
  if (!hasAttempts) return null;
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Rascunho</p>
      <div className="grid grid-cols-1 gap-1.5">
        {board.map((c, i) =>
          c.known !== null || c.attempts.length === 0 ? null : (
            <div key={i} className="text-xs flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground shrink-0">{ordinal(i + 1)}:</span>
              {c.attempts.map((a, j) => (
                <span
                  key={j}
                  className={`font-display font-bold px-1.5 py-0.5 rounded-lg ${
                    a.feedback === "higher"
                      ? "bg-primary/10 text-primary"
                      : "bg-accent/10 text-accent"
                  }`}
                >
                  {a.digit} → {a.feedback === "higher" ? "maior" : "menor"}
                </span>
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  return `${n}º`;
}
