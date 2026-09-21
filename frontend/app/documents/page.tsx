import { DocumentCreator } from "@/components/DocumentCreator";
import { RequireLogin } from "@/components/RequireLogin";
import { loadMutualNdaTemplates } from "@/lib/templates";

export default async function DocumentsPage() {
  const templates = await loadMutualNdaTemplates();

  return (
    <RequireLogin>
      <main className="flex-1">
        <DocumentCreator templates={templates} />
      </main>
    </RequireLogin>
  );
}
