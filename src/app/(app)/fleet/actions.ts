"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string } | undefined;

function s(v: FormDataEntryValue | null): string | null {
  const t = v ? String(v).trim() : "";
  return t.length ? t : null;
}
function num(v: FormDataEntryValue | null): number | null {
  const t = v ? String(v).trim() : "";
  if (!t.length) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

export async function saveVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fleetCode = s(formData.get("fleet_code"));
  const makeModel = s(formData.get("make_model"));
  const kind = s(formData.get("kind"));
  const site = s(formData.get("site"));
  const ownership = s(formData.get("ownership"));
  const meterKind = s(formData.get("meter_kind"));
  if (!fleetCode || !makeModel || !kind || !site || !ownership || !meterKind)
    return { error: "Fleet code, make/model, kind, site, ownership and meter kind are required." };

  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("save_vehicle", {
    p_fleet_code: fleetCode,
    p_make_model: makeModel,
    p_kind: kind,
    p_site: site,
    p_ownership: ownership,
    p_meter_kind: meterKind,
    p_rego_no: s(formData.get("rego_no")),
    p_year: num(formData.get("year")),
    p_fuel_kind: s(formData.get("fuel_kind")),
  });
  if (error) return { error: error.message };
  revalidatePath("/fleet/vehicles");
  redirect("/fleet/vehicles");
}

export async function addMeterReadingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const vehicleId = num(formData.get("vehicle_id"));
  const reading = num(formData.get("reading"));
  if (!vehicleId || reading === null) return { error: "A reading is required." };
  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("add_meter_reading", {
    p_vehicle_id: vehicleId,
    p_reading: reading,
    p_source: "manual",
  });
  if (error) return { error: error.message };
  revalidatePath(`/fleet/vehicles/${vehicleId}`);
  return {};
}

export async function logFuelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const vehicleId = num(formData.get("vehicle_id"));
  const filledAt = s(formData.get("filled_at"));
  const litres = num(formData.get("litres"));
  const cost = num(formData.get("cost_fjd"));
  if (!vehicleId || !filledAt || !litres || cost === null)
    return { error: "Date, litres and cost are required." };
  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("log_fuel", {
    p_vehicle_id: vehicleId,
    p_filled_at: filledAt,
    p_litres: litres,
    p_cost_fjd: cost,
    p_meter_reading: num(formData.get("meter_reading")),
    p_is_full_fill: formData.get("is_full_fill") === "on",
    p_vendor: s(formData.get("vendor")),
  });
  if (error) return { error: error.message };
  revalidatePath(`/fleet/vehicles/${vehicleId}`);
  return {};
}

export async function saveRenewalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const vehicleId = num(formData.get("entity_id"));
  const kind = s(formData.get("kind"));
  const dueDate = s(formData.get("due_date"));
  if (!vehicleId || !kind || !dueDate)
    return { error: "Kind and due date are required." };
  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("save_renewal", {
    p_entity_type: "vehicle",
    p_entity_id: vehicleId,
    p_kind: kind,
    p_due_date: dueDate,
    p_reference_no: s(formData.get("reference_no")),
    p_reminder_days: num(formData.get("reminder_days")) ?? 30,
  });
  if (error) return { error: error.message };
  revalidatePath(`/fleet/vehicles/${vehicleId}`);
  revalidatePath("/fleet/renewals");
  return {};
}

export async function completeRenewalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const renewalId = num(formData.get("renewal_id"));
  const nextDue = s(formData.get("next_due_date"));
  if (!renewalId || !nextDue) return { error: "Next due date is required." };
  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("complete_renewal", {
    p_renewal_id: renewalId,
    p_next_due_date: nextDue,
    p_reference_no: s(formData.get("reference_no")),
  });
  if (error) return { error: error.message };
  revalidatePath("/fleet/renewals");
  return {};
}

export async function openJobCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const vehicleId = num(formData.get("vehicle_id"));
  const kind = s(formData.get("kind"));
  const description = s(formData.get("description"));
  const workshop = s(formData.get("workshop"));
  if (!vehicleId || !kind || !description || !workshop) {
    return { error: "Vehicle, kind, description and workshop are required." };
  }
  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("open_job_card", {
    p_vehicle_id: vehicleId,
    p_kind: kind,
    p_description: description,
    p_workshop: workshop,
    p_vendor_name: s(formData.get("vendor_name")),
  });
  if (error) return { error: error.message };
  revalidatePath("/fleet/jobcards");
  return {};
}

export async function transitionJobCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const jobId = num(formData.get("job_id"));
  const to = s(formData.get("to_status"));
  if (!jobId || !to) return { error: "Missing job card or target status." };
  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("transition_job_card", {
    p_job_id: jobId,
    p_to_status: to,
    p_note: s(formData.get("note")),
    p_parts_cost: num(formData.get("parts_cost")),
    p_labour_cost: num(formData.get("labour_cost")),
    p_downtime_hours: num(formData.get("downtime_hours")),
    p_po_ref: s(formData.get("po_ref")),
    p_invoice_ref: s(formData.get("invoice_ref")),
  });
  if (error) return { error: error.message };
  revalidatePath("/fleet/jobcards");
  return {};
}

export async function runRemindersAction(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.schema("fleet").rpc("run_reminders");
  if (error) throw new Error(error.message);
  revalidatePath("/fleet/renewals");
  redirect("/fleet/renewals");
}
