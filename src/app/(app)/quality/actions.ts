"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string } | undefined;

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v ? String(v).trim() : "";
  return s.length ? s : null;
}

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = v ? String(v).trim() : "";
  if (!s.length) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowOf<T>(data: unknown): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

// ── NCR ──────────────────────────────────────────────────────────────────
export async function raiseNcrAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const source = emptyToNull(formData.get("source"));
  const description = emptyToNull(formData.get("description"));
  const severity = emptyToNull(formData.get("severity"));
  if (!source || !description || !severity) {
    return { error: "Source, description and severity are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.schema("quality").rpc("raise_ncr", {
    p_source: source,
    p_description: description,
    p_severity: severity,
    p_plant: emptyToNull(formData.get("plant")),
    p_lot_no: emptyToNull(formData.get("lot_no")),
    p_item_id: numOrNull(formData.get("item_id")),
  });
  if (error) return { error: error.message };

  const ncr = rowOf<{ ncr_id: number }>(data);
  revalidatePath("/quality/ncr");
  redirect(`/quality/ncr/${ncr.ncr_id}`);
}

export async function transitionNcrAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ncrId = numOrNull(formData.get("ncr_id"));
  const toStatus = emptyToNull(formData.get("to_status"));
  if (!ncrId || !toStatus) return { error: "Missing NCR or target status." };

  const supabase = await createClient();
  const { error } = await supabase.schema("quality").rpc("transition_ncr", {
    p_ncr_id: ncrId,
    p_to_status: toStatus,
    p_disposition: emptyToNull(formData.get("disposition")),
    p_note: emptyToNull(formData.get("note")),
  });
  if (error) return { error: error.message };

  revalidatePath(`/quality/ncr/${ncrId}`);
  redirect(`/quality/ncr/${ncrId}`);
}

// ── CAPA ─────────────────────────────────────────────────────────────────
export async function raiseCapaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const kind = emptyToNull(formData.get("kind"));
  const actionPlan = emptyToNull(formData.get("action_plan"));
  const ownerId = numOrNull(formData.get("owner_id"));
  const dueDate = emptyToNull(formData.get("due_date"));
  if (!kind || !actionPlan || !ownerId || !dueDate) {
    return { error: "Kind, action plan, owner and due date are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.schema("quality").rpc("raise_capa", {
    p_kind: kind,
    p_action_plan: actionPlan,
    p_owner_id: ownerId,
    p_due_date: dueDate,
    p_ncr_id: numOrNull(formData.get("ncr_id")),
    p_root_cause: emptyToNull(formData.get("root_cause")),
  });
  if (error) return { error: error.message };

  const capa = rowOf<{ capa_id: number }>(data);
  revalidatePath("/quality/capa");
  redirect(`/quality/capa/${capa.capa_id}`);
}

export async function transitionCapaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const capaId = numOrNull(formData.get("capa_id"));
  const toStatus = emptyToNull(formData.get("to_status"));
  if (!capaId || !toStatus) return { error: "Missing CAPA or target status." };

  const supabase = await createClient();
  const { error } = await supabase.schema("quality").rpc("transition_capa", {
    p_capa_id: capaId,
    p_to_status: toStatus,
    p_note: emptyToNull(formData.get("note")),
    p_root_cause: emptyToNull(formData.get("root_cause")),
    p_effectiveness_check: emptyToNull(formData.get("effectiveness_check")),
  });
  if (error) return { error: error.message };

  revalidatePath(`/quality/capa/${capaId}`);
  redirect(`/quality/capa/${capaId}`);
}
