import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { BomForm } from "./BomForm";

export const dynamic = "force-dynamic";

export default async function NewBomPage() {
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
        title="New BOM"
        subtitle="Materials-only manufacturing BOM. Parent and components are canonical (BC-mastered) items."
      />
      <BomForm items={items ?? []} />
    </div>
  );
}
