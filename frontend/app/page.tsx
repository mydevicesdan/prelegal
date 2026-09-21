import { AuthLayout } from "@/components/AuthLayout";
import { SignInForm } from "@/components/AuthForms";

export default function SignInPage() {
  return (
    <AuthLayout>
      <SignInForm />
    </AuthLayout>
  );
}
