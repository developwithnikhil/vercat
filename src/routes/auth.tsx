import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const searchSchema = z.object({ mode: z.enum(["login", "signup"]).catch("login") });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Sign in — vercat" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/chat", replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute left-1/2 top-1/3 -z-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground glow-primary">
            <MessageCircle className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold">vercat</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-col items-center px-4 py-8">
        <div className="w-full rounded-2xl border border-border bg-card/80 p-6 shadow-2xl backdrop-blur-xl">
          <h1 className="mb-1 text-2xl font-bold">Welcome to vercat</h1>
          <p className="mb-6 text-sm text-muted-foreground">Sign in or create an account to start chatting.</p>
          <Tabs defaultValue={mode}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Log in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="login"><LoginForm /></TabsContent>
            <TabsContent value="signup"><SignupForm /></TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Welcome back!");
  }
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <div><Label htmlFor="li-email">Email</Label><Input id="li-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><Label htmlFor="li-pw">Password</Label><Input id="li-pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Log in"}</Button>
    </form>
  );
}

function SignupForm() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(u)) {
      toast.error("Username: 3–20 chars, a–z, 0–9, _");
      return;
    }
    setBusy(true);
    const { data: available, error: rpcErr } = await supabase.rpc("username_available", { _username: u });
    if (rpcErr) {
      setBusy(false);
      toast.error(rpcErr.message);
      return;
    }
    if (available === false) {
      setBusy(false);
      toast.error("Username already exists. Please pick another.");
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        data: { username: u, display_name: u },
      },
    });
    setBusy(false);
    if (error) {
      const msg = /database error|username_taken|unique/i.test(error.message)
        ? "Username already exists. Please pick another."
        : error.message;
      toast.error(msg);
    } else toast.success("Account created! You're in.");
  }
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <div><Label htmlFor="su-user">Username</Label><Input id="su-user" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="nikhil" autoComplete="off" /></div>
      <div><Label htmlFor="su-email">Email</Label><Input id="su-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><Label htmlFor="su-pw">Password</Label><Input id="su-pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <Button type="submit" className="w-full glow-primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
    </form>
  );
}
