import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../lib/supabase";

const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 12;

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ professors: [] });
  }

  const { data, error } = await getSupabase()
    .from("professors")
    .select("normalized_name")
    .ilike("normalized_name", `%${query}%`)
    .order("normalized_name")
    .limit(MAX_RESULTS);

  if (error) {
    return NextResponse.json(
      { error: `Could not search professors: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    professors: Array.from(
      new Set((data ?? []).map((professor) => professor.normalized_name)),
    ),
  });
}