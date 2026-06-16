import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MessageCircle, Zap, Users, Shield, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "vercat — realtime chat with friends" },
      { name: "description", content: "Add friends by username and chat in realtime. Modern, fast, built for the web." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && user) navigate({ to: "/chat", replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground glow-primary">
              <MessageCircle className="h-4 w-4" />
            </div>
            <span className="text-lg font-bold tracking-tight">vercat</span>
          </Link>
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm"><Link to="/auth" search={{ mode: "login" }}>Log in</Link></Button>
            <Button asChild size="sm" className="glow-primary"><Link to="/auth" search={{ mode: "signup" }}>Sign up</Link></Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute left-1/2 top-1/2 -z-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="relative mx-auto max-w-4xl px-4 pb-24 pt-24 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--online)]" />
            Realtime, end-to-end fast
          </div>
          <h1 className="bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-7xl">
            Chat that feels instant.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
            vercat connects you with friends in real time. Find anyone by username, send a request, and start talking.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="glow-primary">
              <Link to="/auth" search={{ mode: "signup" }}>Get started — it's free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth" search={{ mode: "login" }}>I already have an account</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="mb-12 text-center text-3xl font-bold tracking-tight">Built for real conversations</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Zap, title: "Real-time messaging", desc: "Messages arrive instantly over WebSockets. No refresh, no delay." },
            { icon: Users, title: "Friends by username", desc: "Search anyone by their handle. Send a request, accept, start chatting." },
            { icon: Shield, title: "Online presence", desc: "See who's online right now with live presence indicators." },
          ].map((f) => (
            <div key={f.title} className="group rounded-2xl border border-border bg-card p-6 transition hover:border-primary/40 hover:glow-primary">
              <div className="mb-4 inline-grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-1 font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-20">
        <div className="rounded-3xl border border-border bg-gradient-to-br from-card to-card/40 p-8 sm:p-12">
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
            <img
              src="https://mhjxdyyzeanbjnyaswcv.supabase.co/storage/v1/object/public/avatars/myimage.jpeg"
              alt="Nikhil, founder of vercat"
              className="h-28 w-28 shrink-0 rounded-full object-cover ring-2 ring-primary/60 glow-primary"
            />
            <div>
              <p className="mb-2 text-xs uppercase tracking-widest text-primary">About the founder</p>
              <h3 className="mb-3 text-2xl font-bold">Nikhil</h3>
              <p className="text-muted-foreground">
                Hi, I'm Nikhil — the creator of vercat. I built this because I wanted a chat app that's modern,
                fast, and a joy to use. vercat is the realtime experience I always wished existed.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} vercat. Built by Nikhil.</p>
          <div className="flex items-center gap-3">
            <Github className="h-4 w-4" />
            <ThemeToggle />
          </div>
        </div>
      </footer>
    </div>
  );
}