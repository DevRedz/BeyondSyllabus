import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../../lib/supabase";
import { createClient } from "../../../../../lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: { bulletId: string } },
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  if (!UUID_PATTERN.test(params.bulletId)) {
    return NextResponse.json({ error: "Choose a valid resume bullet." }, { status: 400 });
  }

  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to vote on resume bullets." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The vote payload is invalid." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "The vote payload is invalid." }, { status: 400 });
  }
  const vote = (body as Record<string, unknown>).vote;
  if (vote !== 1 && vote !== -1 && vote !== null) {
    return NextResponse.json({ error: "Vote must be an upvote, downvote, or null." }, { status: 400 });
  }

  const admin = getSupabase();
  const { data: bullet, error: bulletError } = await admin
    .from("ai_generations")
    .select("id, course_id")
    .eq("id", params.bulletId)
    .eq("is_public", true)
    .eq("item_type", "resume_bullet")
    .maybeSingle();
  if (bulletError) {
    return NextResponse.json({ error: `Could not load the resume bullet: ${bulletError.message}` }, { status: 500 });
  }
  if (!bullet) {
    return NextResponse.json({ error: "Public resume bullet not found." }, { status: 404 });
  }

  const { data: completedCourse, error: enrollmentError } = await admin
    .from("user_courses")
    .select("id")
    .eq("user_id", user.id)
    .eq("course_id", bullet.course_id)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();
  if (enrollmentError) {
    return NextResponse.json({ error: `Could not verify course completion: ${enrollmentError.message}` }, { status: 500 });
  }
  if (!completedCourse) {
    return NextResponse.json({ error: "Only users who completed this course can vote on its resume bullets." }, { status: 403 });
  }

  const { error: voteError } = vote === null
    ? await admin.from("votes").delete().eq("generation_id", bullet.id).eq("user_id", user.id)
    : await admin.from("votes").upsert(
        { generation_id: bullet.id, user_id: user.id, vote_value: vote },
        { onConflict: "user_id,generation_id" },
      );
  if (voteError) {
    return NextResponse.json({ error: `Could not save your vote: ${voteError.message}` }, { status: 500 });
  }

  const [upvotes, downvotes] = await Promise.all([
    admin.from("votes").select("id", { count: "exact", head: true }).eq("generation_id", bullet.id).eq("vote_value", 1),
    admin.from("votes").select("id", { count: "exact", head: true }).eq("generation_id", bullet.id).eq("vote_value", -1),
  ]);
  if (upvotes.error || downvotes.error) {
    return NextResponse.json({ error: `Vote saved, but totals could not be refreshed: ${upvotes.error?.message ?? downvotes.error?.message}` }, { status: 500 });
  }

  return NextResponse.json({ userVote: vote, upvotes: upvotes.count ?? 0, downvotes: downvotes.count ?? 0 });
}
