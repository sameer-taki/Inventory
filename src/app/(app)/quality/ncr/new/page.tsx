import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { NcrForm } from "./NcrForm";

export const dynamic = "force-dynamic";

export default async function NewNcrPage() {
  const supabase = await createClient();
  const { data: items } = await supabase
    .schema("ops")
    .from("items")
    .select("item_id, item_no, description")
    .eq("is_active", true)
    .order("item_no")
    .returns<{ item_id: number; item_no: string; description: string }[]>();

  return (
    <div>
      <PageHeader
        title="Raise NCR"
        subtitle="A new non-conformance report opens in 'open' status with its first event logged."
      />
      <NcrForm items={items ?? []} />
    </div>
  );
}
