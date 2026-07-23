import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { POForm } from "./POForm";

export const dynamic = "force-dynamic";

export default async function NewProductionOrderPage() {
  const supabase = await createClient();
  const [{ data: boms }, { data: routings }, { data: items }] =
    await Promise.all([
      supabase
        .schema("mfg")
        .from("boms")
        .select("bom_id, item_id, version_no")
        .eq("status", "approved")
        .returns<{ bom_id: number; item_id: number; version_no: number }[]>(),
      supabase
        .schema("mfg")
        .from("routings")
        .select("routing_id, item_id, version_no")
        .eq("status", "approved")
        .returns<{ routing_id: number; item_id: number; version_no: number }[]>(),
      supabase
        .schema("ops")
        .from("items")
        .select("item_id, item_no")
        .returns<{ item_id: number; item_no: string }[]>(),
    ]);

  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i.item_no]));
  const bomsWithItem = (boms ?? []).map((b) => ({
    ...b,
    item_no: itemMap.get(b.item_id) ?? String(b.item_id),
  }));

  return (
    <div>
      <PageHeader
        title="New production order"
        subtitle="Opens in 'planned'. Firm → release before posting completions."
      />
      <POForm boms={bomsWithItem} routings={routings ?? []} />
    </div>
  );
}
