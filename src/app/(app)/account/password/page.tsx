import { PageHeader } from "@/components/PageHeader";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default function AccountPasswordPage() {
  return (
    <div>
      <PageHeader
        title="Change password"
        subtitle="Set a new password for your account. You stay signed in."
      />
      <ChangePasswordForm />
    </div>
  );
}
