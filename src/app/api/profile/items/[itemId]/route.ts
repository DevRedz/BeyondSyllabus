import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../../lib/supabase";
import { createClient } from "../../../../../lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, { params }: { params: { itemId: string } }) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  if (!UUID_PATTERN.test(params.itemId)) {
    return NextResponse.json({ error: "Choose a valid saved item." }, { status: 400 });
  }
  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in to remove saved items." }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("ai_generations")
    .delete()
    .eq("id", params.itemId)
    .eq("user_id", user.id)
    .in("item_type", ["skill", "resume_bullet"])
    .select("id, item_type")
    .maybeSingle();
  if (error) return NextResponse.json({ error: `Could not remove the saved item: ${error.message}` }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Saved item not found." }, { status: 404 });
  return NextResponse.json({ deleted: data.item_type });
}
