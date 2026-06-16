import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GENERIC_ERROR = "Could not delete account. Please try again.";

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Best-effort cleanup of user data + storage. Auth user deletion will
    // cascade the profile (FK ON DELETE CASCADE).
    try {
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("attachment_url")
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
      const paths = (msgs ?? [])
        .map((m) => m.attachment_url)
        .filter((v): v is string => !!v && !/^https?:\/\//i.test(v));
      if (paths.length) await supabaseAdmin.storage.from("chat-attachments").remove(paths);
    } catch (e) { console.error("[deleteMyAccount] attachments cleanup", e); }

    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
      if (prof?.avatar_path) await supabaseAdmin.storage.from("avatars").remove([prof.avatar_path]);
    } catch (e) { console.error("[deleteMyAccount] avatar cleanup", e); }

    await supabaseAdmin.from("messages").delete().or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
    await supabaseAdmin.from("friendships").delete().or(`user_a.eq.${userId},user_b.eq.${userId}`);
    await supabaseAdmin.from("friend_requests").delete().or(`from_user.eq.${userId},to_user.eq.${userId}`);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("[deleteMyAccount] auth.admin.deleteUser", error);
      throw new Error(GENERIC_ERROR);
    }
    return { ok: true };
  });
