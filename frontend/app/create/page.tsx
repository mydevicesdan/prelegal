import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { CreateWorkspace } from "@/components/CreateWorkspace";
import { loadMutualNdaTemplates } from "@/lib/templates";

export const metadata = { title: "Document - Prelegal" };

export default async function CreatePage() {
  const templates = await loadMutualNdaTemplates();

  return (
    <AppShell>
      {/* useSearchParams needs a boundary in a static export. */}
      <Suspense fallback={null}>
        <CreateWorkspace templates={templates} />
      </Suspense>
    </AppShell>
  );
}
