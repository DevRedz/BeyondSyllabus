import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../../lib/supabase";
import { createClient } from "../../../../../lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  if (!UUID_PATTERN.test(params.courseId)) {
    return NextResponse.json({ error: "Choose a valid course." }, { status: 400 });
  }
  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in to remove courses." }, { status: 401 });

  const admin = getSupabase();
  const { data: courseLink, error: courseError } = await admin
    .from("user_courses")
    .select("id")
    .eq("user_id", user.id)
    .eq("course_id", params.courseId)
    .maybeSingle();
  if (courseError) return NextResponse.json({ error: `Could not load your course: ${courseError.message}` }, { status: 500 });
  if (!courseLink) return NextResponse.json({ error: "Course not found in your profile." }, { status: 404 });

  const { data: items, error: itemsError } = await admin
    .from("ai_generations")
    .select("id, item_type")
    .eq("user_id", user.id)
    .eq("course_id", params.courseId);
  if (itemsError) return NextResponse.json({ error: `Could not count saved course items: ${itemsError.message}` }, { status: 500 });
  const [{ data: skillRows, error: skillRowsError }, { data: communityItems, error: communityItemsError }] = await Promise.all([
    admin.from("course_skills").select("id").eq("course_id", params.courseId),
    admin.from("ai_generations").select("id").eq("course_id", params.courseId).eq("is_public", true),
  ]);
  if (skillRowsError || communityItemsError) {
    return NextResponse.json({ error: `Could not load course community items: ${skillRowsError?.message ?? communityItemsError?.message}` }, { status: 500 });
  }
  const { count: sectionCount, error: historyCountError } = await admin
    .from("user_course_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("course_id", params.courseId);
  if (historyCountError) return NextResponse.json({ error: `Could not count saved course sections: ${historyCountError.message}` }, { status: 500 });

  const skillIds = (skillRows ?? []).map((skill) => skill.id);
  if (skillIds.length) {
    const { error } = await admin.from("course_skill_votes").delete().eq("user_id", user.id).in("course_skill_id", skillIds);
    if (error) return NextResponse.json({ error: `Could not remove your course skill votes: ${error.message}` }, { status: 500 });
  }
  const generationIds = (communityItems ?? []).map((item) => item.id);
  if (generationIds.length) {
    const { error } = await admin.from("votes").delete().eq("user_id", user.id).in("generation_id", generationIds);
    if (error) return NextResponse.json({ error: `Could not remove your community votes: ${error.message}` }, { status: 500 });
  }

  const { error: itemDeleteError } = await admin
    .from("ai_generations")
    .delete()
    .eq("user_id", user.id)
    .eq("course_id", params.courseId);
  if (itemDeleteError) return NextResponse.json({ error: `Could not delete saved course items: ${itemDeleteError.message}` }, { status: 500 });

  const { error: historyDeleteError } = await admin
    .from("user_course_history")
    .delete()
    .eq("user_id", user.id)
    .eq("course_id", params.courseId);
  if (historyDeleteError) return NextResponse.json({ error: `Saved items were removed, but course sections could not be deleted: ${historyDeleteError.message}` }, { status: 500 });

  const { error: courseDeleteError } = await admin
    .from("user_courses")
    .delete()
    .eq("user_id", user.id)
    .eq("course_id", params.courseId);
  if (courseDeleteError) return NextResponse.json({ error: `Saved items were removed, but the course could not be deleted: ${courseDeleteError.message}` }, { status: 500 });

  return NextResponse.json({
    deletedSkills: (items ?? []).filter((item) => item.item_type === "skill").length,
    deletedBullets: (items ?? []).filter((item) => item.item_type === "resume_bullet").length,
    deletedSections: sectionCount ?? 0,
  });
}
