import { AppShell } from "@/components/AppShell";
import { MyDocuments } from "@/components/MyDocuments";

export const metadata = { title: "My documents - Prelegal" };

export default function DocumentsPage() {
  return (
    <AppShell>
      <MyDocuments />
    </AppShell>
  );
}
