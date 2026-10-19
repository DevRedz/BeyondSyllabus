import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../../lib/supabase";
import { createClient } from "../../../../../lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: { skillId: string } },
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "Request origin could not be verified." },
      { status: 403 },
    );
  }
  if (!UUID_PATTERN.test(params.skillId)) {
    return NextResponse.json({ error: "Choose a valid course skill." }, { status: 400 });
  }

  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to vote on course skills." }, { status: 401 });
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
  const { data: skill, error: skillError } = await admin
    .from("course_skills")
    .select("id, course_id")
    .eq("id", params.skillId)
    .maybeSingle();
  if (skillError) {
    return NextResponse.json(
      { error: `Could not load the course skill: ${skillError.message}` },
      { status: 500 },
    );
  }
  if (!skill) {
    return NextResponse.json({ error: "Course skill not found." }, { status: 404 });
  }

  const { data: completedCourse, error: enrollmentError } = await admin
    .from("user_courses")
    .select("offering_id, course_offerings!inner(course_id)")
    .eq("user_id", user.id)
    .eq("status", "completed")
    .eq("course_offerings.course_id", skill.course_id)
    .limit(1)
    .maybeSingle();
  if (enrollmentError) {
    return NextResponse.json(
      { error: `Could not verify course completion: ${enrollmentError.message}` },
      { status: 500 },
    );
  }
  if (!completedCourse) {
    return NextResponse.json(
      { error: "Only users who completed this course can vote on its skills." },
      { status: 403 },
    );
  }

  const { error: voteError } =
    vote === null
      ? await admin
          .from("course_skill_votes")
          .delete()
          .eq("course_skill_id", skill.id)
          .eq("user_id", user.id)
      : await admin.from("course_skill_votes").upsert(
          { course_skill_id: skill.id, user_id: user.id, vote },
          { onConflict: "course_skill_id,user_id" },
        );
  if (voteError) {
    return NextResponse.json(
      { error: `Could not save your vote: ${voteError.message}` },
      { status: 500 },
    );
  }

  const [upvotesResult, downvotesResult] = await Promise.all([
    admin
      .from("course_skill_votes")
      .select("id", { count: "exact", head: true })
      .eq("course_skill_id", skill.id)
      .eq("vote", 1),
    admin
      .from("course_skill_votes")
      .select("id", { count: "exact", head: true })
      .eq("course_skill_id", skill.id)
      .eq("vote", -1),
  ]);
  if (upvotesResult.error || downvotesResult.error) {
    return NextResponse.json(
      {
        error: `Vote saved, but totals could not be refreshed: ${
          upvotesResult.error?.message ?? downvotesResult.error?.message
        }`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    userVote: vote,
    upvotes: upvotesResult.count ?? 0,
    downvotes: downvotesResult.count ?? 0,
  });
}
