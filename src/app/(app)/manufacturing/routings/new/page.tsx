import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { RoutingForm } from "./RoutingForm";

export const dynamic = "force-dynamic";

export default async function NewRoutingPage() {
  const supabase = await createClient();
  const [{ data: items }, { data: wcs }] = await Promise.all([
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .eq("is_active", true)
      .order("item_no")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
    supabase
      .schema("mfg")
      .from("work_centres")
      .select("work_centre_id, code, name, is_active")
      .eq("is_active", true)
      .order("code")
      .returns<{ work_centre_id: number; code: string; name: string; is_active: boolean }[]>(),
  ]);

  return (
    <div>
      <PageHeader
        title="New routing"
        subtitle="Operation sequence over work centres for a finished good. Creates a draft; approve it to make it effective (any prior approved version is superseded)."
      />
      <RoutingForm items={items ?? []} workCentres={wcs ?? []} />
    </div>
  );
}
