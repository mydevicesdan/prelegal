import { AuthLayout } from "@/components/AuthLayout";
import { SignUpForm } from "@/components/AuthForms";

export const metadata = { title: "Create your account - Prelegal" };

export default function SignUpPage() {
  return (
    <AuthLayout>
      <SignUpForm />
    </AuthLayout>
  );
}
