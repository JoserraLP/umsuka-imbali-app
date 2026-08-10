import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { QuestionForm } from "@/app/questions/new/question-form";

export const metadata: Metadata = {
  title: "Nueva pregunta",
};

export default async function NewQuestionPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            Nueva pregunta
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plantea una consulta o duda a la comunidad de Umsuka Imbali.
          </p>
        </div>

        <QuestionForm
          defaultValues={{
            title: "",
            content: "",
            category: "general",
            priority: "media",
          }}
        />
      </div>
    </AppShell>
  );
}
