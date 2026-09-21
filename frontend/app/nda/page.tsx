import { NdaCreator } from "@/components/NdaCreator";
import { RequireLogin } from "@/components/RequireLogin";
import { loadMutualNdaTemplates } from "@/lib/templates";

export default async function NdaPage() {
  const templates = await loadMutualNdaTemplates();

  return (
    <RequireLogin>
      <main className="flex-1">
        <NdaCreator templates={templates} />
      </main>
    </RequireLogin>
  );
}
