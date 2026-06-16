import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, FileIcon, LogOut, MessageCircle, Mic, Paperclip, Search, Send, Smile, Square,
  UserPlus, Check, X, Users, Download, MoreHorizontal, Copy, Pencil, Trash2, Camera, ImageIcon,
} from "lucide-react";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { acceptFriendRequest, declineFriendRequest } from "@/lib/friends.functions";
import { deleteMyAccount } from "@/lib/account.functions";
import { cn } from "@/lib/utils";

function friendlyError(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (/row-level security|rls|policy|permission/i.test(msg)) return "Action not permitted.";
  if (/duplicate|unique/i.test(msg)) return "Already exists.";
  if (/network|fetch/i.test(msg)) return "Network error. Please try again.";
  return "Something went wrong. Please try again.";
}

function formatDateSeparator(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
}

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Chat — vercat" }] }),
  component: ChatPage,
});

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  last_seen?: string | null;
  avatar_path?: string | null;
  avatar_url?: string | null;
};
type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string | null;
  created_at: string;
  read_at?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
};
const MESSAGE_COLUMNS = "id, sender_id, recipient_id, content, created_at, read_at, attachment_url, attachment_type, attachment_name, attachment_size";
type IncomingReq = { id: string; from_user: string; created_at: string; profile?: Profile };

const ONLINE_WINDOW_MS = 60_000;

async function signAvatar(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

// Cache of resolved short-lived signed URLs for chat attachments.
// Keyed by storage path; entries expire after ~50min to stay below the 1h URL TTL.
const ATTACHMENT_URL_TTL_MS = 50 * 60 * 1000;
const attachmentUrlCache = new Map<string, { url: string; expiresAt: number }>();

function isLegacyAttachmentUrl(v: string): boolean {
  return /^https?:\/\//i.test(v);
}

async function resolveAttachmentUrl(raw?: string | null): Promise<string | null> {
  if (!raw) return null;
  // Backwards compatibility: older messages stored a full signed URL.
  if (isLegacyAttachmentUrl(raw)) return raw;
  const cached = attachmentUrlCache.get(raw);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data } = await supabase.storage.from("chat-attachments").createSignedUrl(raw, 60 * 60);
  const url = data?.signedUrl ?? null;
  if (url) attachmentUrlCache.set(raw, { url, expiresAt: Date.now() + ATTACHMENT_URL_TTL_MS });
  return url;
}

function formatMessageTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatLastSeen(iso?: string | null): string {
  if (!iso) return "offline";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return "last seen just now";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `last seen ${diffMin} min ago`;
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
  if (sameDay) return `last seen today at ${time}`;
  if (isYest) return `last seen yesterday at ${time}`;
  return `last seen ${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} at ${time}`;
}


function ChatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meId = user?.id;

  const [me, setMe] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<IncomingReq[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showMobilePane, setShowMobilePane] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Load self profile
  useEffect(() => {
    if (!meId) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_path")
        .eq("id", meId)
        .maybeSingle();
      if (!data) return;
      const url = await signAvatar(data.avatar_path);
      setMe({ ...data, avatar_url: url });
    })();
  }, [meId]);

  // Load friends + requests
  useEffect(() => {
    if (!meId) return;
    (async () => {
      const { data: f } = await supabase
        .from("friendships")
        .select("user_a, user_b")
        .or(`user_a.eq.${meId},user_b.eq.${meId}`);
      const ids = (f ?? []).map((r) => (r.user_a === meId ? r.user_b : r.user_a));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, display_name, last_seen, avatar_path")
          .in("id", ids);
        const withUrls = await Promise.all(
          (profs ?? []).map(async (p) => ({ ...p, avatar_url: await signAvatar(p.avatar_path) })),
        );
        setFriends(withUrls);
      } else setFriends([]);

      const { data: reqs } = await supabase
        .from("friend_requests")
        .select("id, from_user, created_at")
        .eq("to_user", meId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (reqs?.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_path")
          .in("id", reqs.map((r) => r.from_user));
        const pmap = new Map((profs ?? []).map((p) => [p.id, p]));
        setRequests(reqs.map((r) => ({ ...r, profile: pmap.get(r.from_user) })));
      } else setRequests([]);
    })();
  }, [meId]);

  // Realtime: friend requests + friendships
  useEffect(() => {
    if (!meId) return;
    const ch = supabase
      .channel(`fr:${meId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "friend_requests", filter: `to_user=eq.${meId}` }, async (payload) => {
        const r = payload.new as { id: string; from_user: string; created_at: string };
        const { data: prof } = await supabase.from("profiles").select("id, username, display_name, avatar_path").eq("id", r.from_user).maybeSingle();
        setRequests((prev) => [{ ...r, profile: prof ?? undefined }, ...prev]);
        toast.info(`New friend request from @${prof?.username ?? "someone"}`);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "friendships" }, async (payload) => {
        const row = payload.new as { user_a: string; user_b: string };
        if (row.user_a !== meId && row.user_b !== meId) return;
        const otherId = row.user_a === meId ? row.user_b : row.user_a;
        const { data: prof } = await supabase.from("profiles").select("id, username, display_name, last_seen, avatar_path").eq("id", otherId).maybeSingle();
        if (!prof) return;
        const url = await signAvatar(prof.avatar_path);
        setFriends((prev) => (prev.some((p) => p.id === prof.id) ? prev : [...prev, { ...prof, avatar_url: url }]));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [meId]);

  // Heartbeat
  useEffect(() => {
    if (!meId) return;
    let cancelled = false;
    const beat = async () => {
      if (cancelled) return;
      await supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", meId);
    };
    beat();
    const iv = setInterval(beat, 25_000);
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [meId]);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(iv);
  }, []);

  // Refresh friends' last_seen
  useEffect(() => {
    if (!meId || friends.length === 0) return;
    const ids = friends.map((f) => f.id);
    let cancelled = false;
    const refresh = async () => {
      const { data } = await supabase.from("profiles").select("id, last_seen").in("id", ids);
      if (cancelled || !data) return;
      const map = new Map(data.map((p) => [p.id, p.last_seen]));
      setFriends((prev) => prev.map((f) => (map.has(f.id) ? { ...f, last_seen: map.get(f.id) ?? f.last_seen } : f)));
    };
    refresh();
    const iv = setInterval(refresh, 20_000);

    const ch = supabase
      .channel(`profiles:friends:${meId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const row = payload.new as { id: string; last_seen: string };
        if (!ids.includes(row.id)) return;
        setFriends((prev) => prev.map((f) => (f.id === row.id ? { ...f, last_seen: row.last_seen } : f)));
      })
      .subscribe();

    return () => { cancelled = true; clearInterval(iv); supabase.removeChannel(ch); };
  }, [meId, friends.map((f) => f.id).join(",")]);

  const [presentIds, setPresentIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!meId) return;
    const ch = supabase.channel("presence:global", { config: { presence: { key: meId } } });
    ch.on("presence", { event: "sync" }, () => {
      setPresentIds(new Set(Object.keys(ch.presenceState())));
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track({ at: new Date().toISOString() });
    });
    return () => { supabase.removeChannel(ch); };
  }, [meId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onlineIds = useMemo(() => {
    const s = new Set<string>(presentIds);
    for (const f of friends) {
      if (f.last_seen && Date.now() - new Date(f.last_seen).getTime() < ONLINE_WINDOW_MS) s.add(f.id);
    }
    return s;
  }, [friends, presentIds, nowTick]);

  const activeFriend = useMemo(() => friends.find((f) => f.id === activeId) ?? null, [friends, activeId]);

  async function handleSignOut() {
    setConfirmLogout(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { mode: "login" }, replace: true });
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className={cn(
        "flex w-full flex-col border-r border-border bg-card md:w-80",
        showMobilePane && "hidden md:flex"
      )}>
        <div className="flex items-center justify-between border-b border-border p-3">
          <button onClick={() => setProfileOpen(true)} className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-accent">
            <Avatar className="h-9 w-9">
              {me?.avatar_url ? <AvatarImage src={me.avatar_url} /> : null}
              <AvatarFallback>{(me?.display_name ?? me?.username ?? user?.user_metadata?.username ?? "me").slice(0,2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="text-left">
              <div className="text-sm font-bold leading-tight">vercat</div>
              <div className="text-[10px] text-muted-foreground">@{me?.username ?? user?.user_metadata?.username ?? "you"}</div>
            </div>
          </button>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={() => setConfirmLogout(true)} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <UserSearch meId={meId!} />

        {requests.length > 0 && (
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <UserPlus className="h-3 w-3" /> Requests
              <Badge variant="secondary" className="ml-1">{requests.length}</Badge>
            </div>
            <div className="space-y-2">
              {requests.map((r) => (
                <RequestRow
                  key={r.id}
                  req={r}
                  onResolved={() => setRequests((prev) => prev.filter((x) => x.id !== r.id))}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Users className="h-3 w-3" /> Friends
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {friends.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">No friends yet. Search a username above to send a request.</p>
            ) : friends.map((f) => (
              <button
                key={f.id}
                onClick={() => { setActiveId(f.id); setShowMobilePane(true); }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-accent",
                  activeId === f.id && "bg-accent"
                )}
              >
                <div className="relative">
                  <Avatar className="h-9 w-9">
                    {f.avatar_url ? <AvatarImage src={f.avatar_url} /> : null}
                    <AvatarFallback>{(f.display_name ?? f.username).slice(0,2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                    onlineIds.has(f.id) ? "bg-[color:var(--online)]" : "bg-[color:var(--offline)]"
                  )} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.display_name ?? f.username}</div>
                  <div className="truncate text-xs text-muted-foreground">{onlineIds.has(f.id) ? <span className="text-[color:var(--online)]">online</span> : formatLastSeen(f.last_seen)}</div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <main className={cn("flex flex-1 flex-col", !showMobilePane && "hidden md:flex")}>
        {activeFriend && meId ? (
          <Conversation
            meId={meId}
            friend={activeFriend}
            online={onlineIds.has(activeFriend.id)}
            onBack={() => setShowMobilePane(false)}
            onUnfriended={(id) => {
              setFriends((prev) => prev.filter((f) => f.id !== id));
              setActiveId(null);
              setShowMobilePane(false);
            }}
          />
        ) : (
          <EmptyState />
        )}
      </main>

      {meId && (
        <ProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          meId={meId}
          me={me}
          onUpdated={(p) => setMe(p)}
        />
      )}

      <Dialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>You'll need to log in again to access your chats.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmLogout(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSignOut}>Sign out</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileDialog({
  open, onOpenChange, meId, me, onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meId: string;
  me: Profile | null;
  onUpdated: (p: Profile) => void;
}) {
  const [displayName, setDisplayName] = useState(me?.display_name ?? "");
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const deleteAccount = useServerFn(deleteMyAccount);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => { setDisplayName(me?.display_name ?? ""); }, [me?.display_name, open]);

  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !me) return;
    if (!f.type.startsWith("image/")) { toast.error("Please choose an image"); return; }
    setUploading(true);
    try {
      const ext = (f.name.split(".").pop() ?? "png").toLowerCase();
      const path = `${meId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, f, { contentType: f.type, upsert: true });
      if (upErr) throw upErr;
      if (me.avatar_path) await supabase.storage.from("avatars").remove([me.avatar_path]).catch(() => {});
      const { error: updErr } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", meId);
      if (updErr) throw updErr;
      const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60);
      onUpdated({ ...me, avatar_path: path, avatar_url: data?.signedUrl ?? null });
      toast.success("Profile picture updated");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally { setUploading(false); }
  }

  async function removeAvatar() {
    if (!me?.avatar_path) return;
    setUploading(true);
    try {
      await supabase.storage.from("avatars").remove([me.avatar_path]).catch(() => {});
      await supabase.from("profiles").update({ avatar_path: null }).eq("id", meId);
      onUpdated({ ...me, avatar_path: null, avatar_url: null });
      toast.success("Profile picture removed");
    } finally { setUploading(false); }
  }

  async function saveName() {
    const v = displayName.trim();
    if (!v || !me) return;
    const { error } = await supabase.from("profiles").update({ display_name: v }).eq("id", meId);
    if (error) { toast.error(friendlyError(error)); return; }
    onUpdated({ ...me, display_name: v });
    toast.success("Saved");
    onOpenChange(false);
  }

  async function performDelete() {
    setDeleting(true);
    try {
      await deleteAccount({ data: undefined });
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      toast.success("Account deleted");
      navigate({ to: "/auth", search: { mode: "login" }, replace: true });
    } catch (err) {
      toast.error(friendlyError(err));
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>Update your picture and display name.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="relative">
            <Avatar className="h-24 w-24">
              {me?.avatar_url ? <AvatarImage src={me.avatar_url} /> : null}
              <AvatarFallback className="text-2xl">{(me?.display_name ?? me?.username ?? "?").slice(0,2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <Button
              size="icon"
              variant="secondary"
              className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full shadow"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change picture"
            >
              <Camera className="h-4 w-4" />
            </Button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <ImageIcon className="mr-1.5 h-3.5 w-3.5" /> {me?.avatar_path ? "Change" : "Upload"}
            </Button>
            {me?.avatar_path && (
              <Button size="sm" variant="ghost" onClick={removeAvatar} disabled={uploading}>Remove</Button>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dn">Display name</Label>
          <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
          <p className="text-xs text-muted-foreground">@{me?.username}</p>
        </div>
        <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-destructive">Danger zone</div>
          <p className="mt-1 text-xs text-muted-foreground">Permanently delete your account, messages, and friends.</p>
          <Button size="sm" variant="destructive" className="mt-2" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete account
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={saveName}>Save</Button>
        </DialogFooter>

        <Dialog open={confirmDelete} onOpenChange={(v) => !deleting && setConfirmDelete(v)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>This permanently removes your profile, messages, attachments, and friendships. This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="destructive" disabled={deleting} onClick={performDelete}>
                {deleting ? "Deleting…" : "Delete forever"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function UserSearch({ meId }: { meId: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [pendingTo, setPendingTo] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(async () => {
      const s = q.trim().toLowerCase();
      if (s.length < 2) { setResults([]); return; }
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .ilike("username", `${s}%`)
        .neq("id", meId)
        .limit(8);
      setResults(data ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q, meId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("friend_requests").select("to_user").eq("from_user", meId).eq("status", "pending");
      setPendingTo(new Set((data ?? []).map((r) => r.to_user)));
    })();
  }, [meId]);

  async function sendRequest(toId: string) {
    const { error } = await supabase.from("friend_requests").insert({ from_user: meId, to_user: toId });
    if (error) {
      if (error.message.includes("duplicate")) toast.info("Request already sent");
      else toast.error(friendlyError(error));
      return;
    }
    setPendingTo((s) => new Set(s).add(toId));
    toast.success("Friend request sent");
  }

  return (
    <div className="border-b border-border p-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username…" className="pl-9" />
      </div>
      {results.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg border border-border bg-background p-1">
          {results.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <div>
                <div className="font-medium">{p.display_name ?? p.username}</div>
                <div className="text-xs text-muted-foreground">@{p.username}</div>
              </div>
              <Button
                size="sm"
                variant={pendingTo.has(p.id) ? "secondary" : "default"}
                disabled={pendingTo.has(p.id)}
                onClick={() => sendRequest(p.id)}
              >
                {pendingTo.has(p.id) ? "Sent" : "Add"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestRow({ req, onResolved }: { req: IncomingReq; onResolved: () => void }) {
  const accept = useServerFn(acceptFriendRequest);
  const decline = useServerFn(declineFriendRequest);
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); onResolved(); }
    catch (e) { toast.error(friendlyError(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-background p-2">
      <Avatar className="h-8 w-8"><AvatarFallback>{(req.profile?.username ?? "?").slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{req.profile?.display_name ?? req.profile?.username ?? "User"}</div>
        <div className="truncate text-xs text-muted-foreground">@{req.profile?.username}</div>
      </div>
      <Button size="icon" variant="ghost" disabled={busy} onClick={() => act(() => accept({ data: { requestId: req.id } }), "Friend added")} aria-label="Accept">
        <Check className="h-4 w-4 text-[color:var(--online)]" />
      </Button>
      <Button size="icon" variant="ghost" disabled={busy} onClick={() => act(() => decline({ data: { requestId: req.id } }), "Declined")} aria-label="Decline">
        <X className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary glow-primary">
          <MessageCircle className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-semibold">Select a friend to start chatting</h2>
        <p className="mt-1 text-sm text-muted-foreground">Or search for someone new to add as a friend.</p>
      </div>
    </div>
  );
}

type PendingAttachment = { file: File; previewUrl: string; kind: "image" | "audio" | "file" };

function Conversation({ meId, friend, online, onBack, onUnfriended }: { meId: string; friend: Profile; online: boolean; onBack: () => void; onUnfriended: (id: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewAvatar, setViewAvatar] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const emojiWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setPending(null);
    setEditingId(null);
    setText("");
    setAttachmentUrls({});
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .or(`and(sender_id.eq.${meId},recipient_id.eq.${friend.id}),and(sender_id.eq.${friend.id},recipient_id.eq.${meId})`)
        .order("created_at", { ascending: true })
        .limit(200);
      setMessages((data as Message[] | null) ?? []);
    })();

    const ch = supabase
      .channel(`conv:${[meId, friend.id].sort().join(":")}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as Message;
        const inConv =
          (m.sender_id === meId && m.recipient_id === friend.id) ||
          (m.sender_id === friend.id && m.recipient_id === meId);
        if (!inConv) return;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
        const old = payload.old as { id: string };
        setMessages((prev) => prev.filter((x) => x.id !== old.id));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [meId, friend.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);




  // Resolve attachment storage paths to short-lived signed URLs for display.
  useEffect(() => {
    let cancelled = false;
    const needed = Array.from(
      new Set(
        messages
          .map((m) => m.attachment_url)
          .filter((v): v is string => !!v && !attachmentUrls[v]),
      ),
    );
    if (needed.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        needed.map(async (raw) => [raw, await resolveAttachmentUrl(raw)] as const),
      );
      if (cancelled) return;
      setAttachmentUrls((prev) => {
        const next = { ...prev };
        for (const [raw, url] of entries) if (url) next[raw] = url;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [messages, attachmentUrls]);

  useEffect(() => {
    if (!showEmoji) return;
    const onClick = (e: MouseEvent) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) setShowEmoji(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showEmoji]);

  async function insertMessage(row: { content?: string | null; attachment_url?: string | null; attachment_type?: string | null; attachment_name?: string | null; attachment_size?: number | null; }) {
    const optimistic: Message = {
      id: `tmp-${crypto.randomUUID()}`,
      sender_id: meId,
      recipient_id: friend.id,
      content: row.content ?? null,
      created_at: new Date().toISOString(),
      attachment_url: row.attachment_url ?? null,
      attachment_type: row.attachment_type ?? null,
      attachment_name: row.attachment_name ?? null,
      attachment_size: row.attachment_size ?? null,
    };
    setMessages((prev) => [...prev, optimistic]);
    const { data, error } = await supabase
      .from("messages")
      .insert({ sender_id: meId, recipient_id: friend.id, ...row })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      toast.error(friendlyError(error));
      return;
    }
    const saved = data as Message;
    setMessages((prev) => {
      const replaced = prev.map((m) => (m.id === optimistic.id ? saved : m));
      return replaced.filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
    });
  }

  async function uploadFile(file: File): Promise<{ path: string; type: string } | null> {
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
    const path = `${meId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (upErr) { toast.error(friendlyError(upErr)); return null; }
    const type = file.type || "application/octet-stream";
    return { path, type };
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();

    // Edit existing message
    if (editingId) {
      if (!body) return;
      const id = editingId;
      setText("");
      setEditingId(null);
      const { error } = await supabase.from("messages").update({ content: body }).eq("id", id);
      if (error) { toast.error(friendlyError(error)); return; }
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: body } : m)));
      return;
    }

    if (!body && !pending) return;
    setText("");
    setShowEmoji(false);

    if (pending) {
      setUploading(true);
      const att = pending;
      setPending(null);
      try {
        const res = await uploadFile(att.file);
        if (!res) return;
        await insertMessage({
          content: body || null,
          attachment_url: res.path,
          attachment_type: res.type,
          attachment_name: att.file.name,
          attachment_size: att.file.size,
        });
      } finally {
        URL.revokeObjectURL(att.previewUrl);
        setUploading(false);
      }
    } else {
      await insertMessage({ content: body });
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const kind: PendingAttachment["kind"] = f.type.startsWith("image/") ? "image" : f.type.startsWith("audio/") ? "audio" : "file";
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending({ file: f, previewUrl: URL.createObjectURL(f), kind });
  }

  function clearPending() {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  async function toggleRecord() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      recordChunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size > 0) recordChunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: mime });
        const ext = mime.includes("webm") ? "webm" : "m4a";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
        if (pending) URL.revokeObjectURL(pending.previewUrl);
        setPending({ file, previewUrl: URL.createObjectURL(file), kind: "audio" });
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (err) {
      toast.error("Microphone access denied");
      console.error(err);
    }
  }

  function startEdit(m: Message) {
    setEditingId(m.id);
    setText(m.content ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setText("");
  }

  async function deleteMessage(m: Message) {
    const prev = messages;
    setMessages((p) => p.filter((x) => x.id !== m.id));
    const { error } = await supabase.from("messages").delete().eq("id", m.id);
    if (error) { toast.error(friendlyError(error)); setMessages(prev); return; }
    toast.success("Deleted");
  }

  async function copyText(s: string) {
    try { await navigator.clipboard.writeText(s); toast.success("Copied"); }
    catch { toast.error("Copy failed"); }
  }

  async function downloadAttachment(m: Message) {
    if (!m.attachment_url) return;
    const signed = await resolveAttachmentUrl(m.attachment_url);
    if (!signed) { toast.error("Could not load file"); return; }
    try {
      const r = await fetch(signed);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m.attachment_name ?? "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(signed, "_blank");
    }
  }

  async function copyAttachmentLink(m: Message) {
    if (!m.attachment_url) return;
    const signed = await resolveAttachmentUrl(m.attachment_url);
    if (!signed) { toast.error("Could not create link"); return; }
    await copyText(signed);
  }

  async function unfriend() {
    const a = meId < friend.id ? meId : friend.id;
    const b = meId < friend.id ? friend.id : meId;
    const { error } = await supabase
      .from("friendships")
      .delete()
      .eq("user_a", a)
      .eq("user_b", b);
    if (error) { toast.error(friendlyError(error)); return; }
    // Also clear any old/declined friend requests so they can re-request later
    await supabase
      .from("friend_requests")
      .delete()
      .or(`and(from_user.eq.${meId},to_user.eq.${friend.id}),and(from_user.eq.${friend.id},to_user.eq.${meId})`);
    toast.success(`Unfriended @${friend.username}`);
    setConfirmUnfriend(false);
    onUnfriended(friend.id);
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border bg-card/50 p-3 backdrop-blur">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <button type="button" onClick={() => setViewAvatar(true)} className="relative rounded-full focus:outline-none focus:ring-2 focus:ring-ring" aria-label="View profile picture">
          <Avatar className="h-9 w-9">
            {friend.avatar_url ? <AvatarImage src={friend.avatar_url} /> : null}
            <AvatarFallback>{(friend.display_name ?? friend.username).slice(0,2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
            online ? "bg-[color:var(--online)]" : "bg-[color:var(--offline)]"
          )} />
        </button>
        <button type="button" onClick={() => setViewAvatar(true)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-semibold">{friend.display_name ?? friend.username}</div>
          <div className="text-xs text-muted-foreground">{online ? <span className="text-[color:var(--online)]">online</span> : formatLastSeen(friend.last_seen)}</div>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Conversation options">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setViewAvatar(true)}>
              <ImageIcon className="mr-2 h-4 w-4" /> View profile picture
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setConfirmUnfriend(true)} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Unfriend
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={viewAvatar} onOpenChange={setViewAvatar}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{friend.display_name ?? friend.username}</DialogTitle>
            <DialogDescription>@{friend.username}</DialogDescription>
          </DialogHeader>
          <div className="grid place-items-center py-2">
            {friend.avatar_url ? (
              <img src={friend.avatar_url} alt={friend.username} className="h-64 w-64 rounded-2xl object-cover" />
            ) : (
              <div className="grid h-64 w-64 place-items-center rounded-2xl bg-muted text-5xl font-semibold text-muted-foreground">
                {(friend.display_name ?? friend.username).slice(0,2).toUpperCase()}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUnfriend} onOpenChange={setConfirmUnfriend}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Unfriend @{friend.username}?</DialogTitle>
            <DialogDescription>You won't be able to message each other until one of you sends a new friend request.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmUnfriend(false)}>Cancel</Button>
            <Button variant="destructive" onClick={unfriend}>Unfriend</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-2">
          {messages.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">Say hi to @{friend.username} 👋</p>
          )}
          {messages.map((m, i) => {
            const mine = m.sender_id === meId;
            const prev = messages[i - 1];
            const grouped = prev && prev.sender_id === m.sender_id;
            const isImage = !!m.attachment_url && (m.attachment_type?.startsWith("image/") ?? false);
            const isAudio = !!m.attachment_url && (m.attachment_type?.startsWith("audio/") ?? false);
            const isFile = !!m.attachment_url && !isImage && !isAudio;
            const hasAttach = !!m.attachment_url;
            const isTemp = m.id.startsWith("tmp-");
            const attachSrc = m.attachment_url ? attachmentUrls[m.attachment_url] ?? null : null;
            const showDate = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            return (
              <div key={m.id}>
                {showDate && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-muted/70 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                      {formatDateSeparator(m.created_at)}
                    </span>
                  </div>
                )}
                <div className={cn("group flex items-end gap-1", mine ? "justify-end" : "justify-start")}>
                {mine && !isTemp && (
                  <MessageMenu
                    side="left"
                    mine
                    hasText={!!m.content}
                    hasAttach={hasAttach}
                    onCopyText={() => m.content && copyText(m.content)}
                    onEdit={() => startEdit(m)}
                    onDelete={() => deleteMessage(m)}
                    onCopyLink={() => copyAttachmentLink(m)}
                    onDownload={() => downloadAttachment(m)}
                  />
                )}
                <div className={cn(
                  "max-w-[78%] overflow-hidden rounded-2xl text-sm",
                  mine ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                  grouped && (mine ? "rounded-tr-md" : "rounded-tl-md"),
                  hasAttach ? "p-1.5" : "px-4 py-2",
                  editingId === m.id && "ring-2 ring-ring",
                )}>
                  {isImage && (
                    attachSrc ? (
                      <a href={attachSrc} target="_blank" rel="noreferrer" className="block">
                        <img src={attachSrc} alt={m.attachment_name ?? "image"} className="max-h-72 w-auto rounded-xl object-cover" />
                      </a>
                    ) : (
                      <div className="h-32 w-48 animate-pulse rounded-xl bg-background/40" />
                    )
                  )}
                  {isAudio && (
                    attachSrc ? (
                      <audio controls src={attachSrc} className="block max-w-full" />
                    ) : (
                      <div className="h-10 w-56 animate-pulse rounded-xl bg-background/40" />
                    )
                  )}
                  {isFile && (
                    <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2", mine ? "bg-primary-foreground/10" : "bg-background/40")}>
                      <FileIcon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{m.attachment_name ?? "file"}</span>
                      <button onClick={() => downloadAttachment(m)} aria-label="Download" className="shrink-0 opacity-70 hover:opacity-100">
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {m.content && (
                    <p className={cn("whitespace-pre-wrap break-words", hasAttach && "px-2.5 pb-1 pt-2")}>{m.content}</p>
                  )}
                  <div className={cn("flex items-center gap-1 text-[10px]", mine ? "justify-end" : "justify-start", hasAttach && !m.content ? "px-2.5 py-1" : m.content ? (hasAttach ? "px-2.5 pb-1" : "px-4 pb-1 pt-0.5") : "px-4 pb-1 pt-0")}>
                    <span className="opacity-70">{formatMessageTime(m.created_at)}</span>
                  </div>

                </div>
                {!mine && !isTemp && (
                  <MessageMenu
                    side="right"
                    mine={false}
                    hasText={!!m.content}
                    hasAttach={hasAttach}
                    onCopyText={() => m.content && copyText(m.content)}
                    onCopyLink={() => copyAttachmentLink(m)}
                    onDownload={() => downloadAttachment(m)}
                  />
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={send} className="relative border-t border-border bg-card/50 p-3 backdrop-blur">
        {showEmoji && (
          <div ref={emojiWrapRef} className="absolute bottom-full left-3 z-30 mb-2">
            <EmojiPicker
              theme={EmojiTheme.AUTO}
              onEmojiClick={(d) => setText((t) => t + d.emoji)}
              lazyLoadEmojis
              width={320}
              height={380}
            />
          </div>
        )}
        <input ref={fileInputRef} type="file" hidden onChange={onFilePicked} />

        {pending && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-lg border border-border bg-background p-2">
            {pending.kind === "image" ? (
              <img src={pending.previewUrl} alt="preview" className="h-12 w-12 rounded object-cover" />
            ) : pending.kind === "audio" ? (
              <audio src={pending.previewUrl} controls className="h-10" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded bg-muted"><FileIcon className="h-5 w-5" /></div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{pending.file.name}</div>
              <div className="text-xs text-muted-foreground">{(pending.file.size / 1024).toFixed(1)} KB — press Enter or Send</div>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={clearPending} aria-label="Remove attachment">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {editingId && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg border border-border bg-background px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">Editing message — press Enter to save</span>
            <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
          </div>
        )}

        <div className="mx-auto flex max-w-3xl items-center gap-1.5">
          <Button type="button" variant="ghost" size="icon" onClick={() => setShowEmoji((s) => !s)} aria-label="Emoji">
            <Smile className="h-5 w-5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled={uploading || recording || !!editingId} onClick={() => fileInputRef.current?.click()} aria-label="Attach file">
            <Paperclip className="h-5 w-5" />
          </Button>
          <Button type="button" variant={recording ? "destructive" : "ghost"} size="icon" disabled={uploading || !!editingId} onClick={toggleRecord} aria-label={recording ? "Stop recording" : "Record voice message"}>
            {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={recording ? "Recording…" : uploading ? "Uploading…" : editingId ? "Edit message…" : pending ? "Add a caption (optional)" : `Message @${friend.username}`}
            autoComplete="off"
            disabled={recording || uploading}
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            className="glow-primary"
            disabled={(!text.trim() && !pending) || recording || uploading || (!!editingId && !text.trim())}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </>
  );
}

function MessageMenu({
  side, mine, hasText, hasAttach, onCopyText, onEdit, onDelete, onCopyLink, onDownload,
}: {
  side: "left" | "right";
  mine: boolean;
  hasText: boolean;
  hasAttach: boolean;
  onCopyText?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopyLink?: () => void;
  onDownload?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 shrink-0 opacity-0 transition group-hover:opacity-100 data-[state=open]:opacity-100",
            side === "left" ? "order-first" : "order-last",
          )}
          aria-label="Message actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={side === "left" ? "end" : "start"}>
        {hasText && (
          <DropdownMenuItem onClick={onCopyText}>
            <Copy className="mr-2 h-4 w-4" /> Copy text
          </DropdownMenuItem>
        )}
        {hasAttach && (
          <>
            <DropdownMenuItem onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" /> Download
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopyLink}>
              <Copy className="mr-2 h-4 w-4" /> Copy link
            </DropdownMenuItem>
          </>
        )}
        {mine && hasText && !hasAttach && (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
        )}
        {mine && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
