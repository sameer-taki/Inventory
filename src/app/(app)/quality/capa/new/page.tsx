import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { CapaForm } from "./CapaForm";

export const dynamic = "force-dynamic";

export default async function NewCapaPage({
  searchParams,
}: {
  searchParams: Promise<{ ncr_id?: string }>;
}) {
  const { ncr_id } = await searchParams;
  const supabase = await createClient();
  const { data: users } = await supabase
    .schema("ops")
    .from("users")
    .select("user_id, full_name, email")
    .eq("is_active", true)
    .order("full_name")
    .returns<{ user_id: number; full_name: string | null; email: string }[]>();

  return (
    <div>
      <PageHeader
        title="Raise CAPA"
        subtitle={
          ncr_id
            ? `Linked to NCR #${ncr_id}. Opens in 'open' status.`
            : "Opens in 'open' status with its first event logged."
        }
      />
      <CapaForm users={users ?? []} ncrId={ncr_id} />
    </div>
  );
}
