import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GENERIC_ERROR = "Could not process request. Please try again.";

export const acceptFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req, error: reqErr } = await supabase
      .from("friend_requests")
      .select("id, from_user, to_user, status")
      .eq("id", data.requestId)
      .maybeSingle();
    if (reqErr) {
      console.error("[acceptFriendRequest] select", reqErr);
      throw new Error(GENERIC_ERROR);
    }
    if (!req) throw new Error("Request not found");
    if (req.to_user !== userId) throw new Error("Not your request");
    if (req.status !== "pending") throw new Error("Already handled");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const a = req.from_user < req.to_user ? req.from_user : req.to_user;
    const b = req.from_user < req.to_user ? req.to_user : req.from_user;

    const { error: insErr } = await supabaseAdmin
      .from("friendships")
      .insert({ user_a: a, user_b: b });
    if (insErr && !insErr.message.includes("duplicate")) {
      console.error("[acceptFriendRequest] insert friendship", insErr);
      throw new Error(GENERIC_ERROR);
    }

    const { error: updErr } = await supabaseAdmin
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", data.requestId);
    if (updErr) {
      console.error("[acceptFriendRequest] update request", updErr);
      throw new Error(GENERIC_ERROR);
    }

    return { ok: true };
  });

export const declineFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("friend_requests")
      .update({ status: "declined" })
      .eq("id", data.requestId)
      .eq("to_user", context.userId);
    if (error) {
      console.error("[declineFriendRequest]", error);
      throw new Error(GENERIC_ERROR);
    }
    return { ok: true };
  });
