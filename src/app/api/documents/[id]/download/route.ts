import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("file_path, mime_type, name")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });

  const admin = createAdminClient();
  const { data: signed, error: signedError } = await admin.storage
    .from("documents")
    .createSignedUrl(data.file_path, 60);

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: signedError?.message ?? "No se pudo generar URL." }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
