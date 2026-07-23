"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string } | undefined;

function n(v: FormDataEntryValue | null): number | null {
  const t = v ? String(v).trim() : "";
  if (!t.length) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}
function s(v: FormDataEntryValue | null): string | null {
  const t = v ? String(v).trim() : "";
  return t.length ? t : null;
}

export async function retryOutboxAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("outbox_id"));
  if (!id) return { error: "Missing row." };
  const supabase = await createClient();
  const { error } = await supabase
    .schema("ops")
    .rpc("outbox_retry", { p_outbox_id: id });
  if (error) return { error: error.message };
  revalidatePath("/admin/outbox");
  return {};
}

export async function markDeadOutboxAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = n(formData.get("outbox_id"));
  if (!id) return { error: "Missing row." };
  const supabase = await createClient();
  const { error } = await supabase
    .schema("ops")
    .rpc("outbox_mark_dead", { p_outbox_id: id, p_note: s(formData.get("note")) });
  if (error) return { error: error.message };
  revalidatePath("/admin/outbox");
  return {};
}
