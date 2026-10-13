import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import { createClient } from "../../../../lib/supabase/server";

type SelectedSkill = {
  category: string;
  name: string;
  evidence: string;
};

function isSelectedSkill(value: unknown): value is SelectedSkill {
  if (!value || typeof value !== "object") return false;
  const skill = value as Record<string, unknown>;
  return (
    typeof skill.category === "string" &&
    skill.category.trim().length > 0 &&
    skill.category.length <= 80 &&
    typeof skill.name === "string" &&
    skill.name.trim().length > 0 &&
    skill.name.length <= 160 &&
    typeof skill.evidence === "string" &&
    skill.evidence.length <= 1000
  );
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "Request origin could not be verified." },
      { status: 403 },
    );
  }

  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to save selected results." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The selection payload is invalid." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "The selection payload is invalid." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const courseId = typeof payload.courseId === "string" ? payload.courseId : "";
  const targetRole = typeof payload.targetRole === "string" ? payload.targetRole.trim() : "";
  const model =
    typeof payload.model === "string" && payload.model.length <= 80
      ? payload.model
      : "unknown";
  const selectedSkills = Array.isArray(payload.skills) ? payload.skills : [];
  const selectedBullets = Array.isArray(payload.bullets)
    ? payload.bullets.filter(
        (bullet): bullet is string =>
          typeof bullet === "string" && bullet.trim().length > 0 && bullet.length <= 1200,
      )
    : [];
  const shareBullets = payload.shareBullets === true;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(courseId)) {
    return NextResponse.json({ error: "Choose a valid course." }, { status: 400 });
  }
  if (!targetRole || targetRole.length > 120) {
    return NextResponse.json({ error: "Add a target role of 120 characters or fewer." }, { status: 400 });
  }
  if (
    selectedSkills.length > 12 ||
    !selectedSkills.every(isSelectedSkill) ||
    selectedBullets.length > 5 ||
    selectedSkills.length + selectedBullets.length === 0
  ) {
    return NextResponse.json({ error: "Select at least one valid skill or resume bullet." }, { status: 400 });
  }

  const admin = getSupabase();
  const { data: course, error: courseError } = await admin
    .from("courses")
    .select("course_code, title")
    .eq("id", courseId)
    .maybeSingle();
  if (courseError || !course) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  let insertedSkills = 0;
  if (selectedSkills.length) {
    const { data: existingSkills, error: existingSkillsError } = await admin
      .from("course_skills")
      .select("skill_name, source_reference")
      .eq("course_id", courseId)
      .eq("source_type", "student_verified");
    if (existingSkillsError) {
      return NextResponse.json({ error: existingSkillsError.message }, { status: 500 });
    }

    const existingKeys = new Set(
      (existingSkills ?? []).map((skill) =>
        `${skill.source_reference ?? ""}|${skill.skill_name.trim().toLowerCase()}`,
      ),
    );
    const skillsToInsert = (selectedSkills as SelectedSkill[])
      .map((skill) => ({
        course_id: courseId,
        skill_name: skill.name.trim(),
        source_type: "student_verified",
        source_reference: `ai-syllabus:${skill.category.trim()}`,
        evidence: skill.evidence.trim() || null,
      }))
      .filter((skill) =>
        !existingKeys.has(
          `${skill.source_reference}|${skill.skill_name.toLowerCase()}`,
        ),
      );

    if (skillsToInsert.length) {
      const { error } = await admin.from("course_skills").insert(skillsToInsert);
      if (error) {
        return NextResponse.json({ error: `Could not save selected skills: ${error.message}` }, { status: 500 });
      }
      insertedSkills = skillsToInsert.length;
    }
  }

  let insertedBullets = 0;
  if (selectedBullets.length) {
    const { data: existingGenerations, error: existingGenerationsError } = await admin
      .from("ai_generations")
      .select("generated_text")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .eq("target_role", targetRole);
    if (existingGenerationsError) {
      return NextResponse.json({ error: existingGenerationsError.message }, { status: 500 });
    }

    const existingBulletTexts = new Set(
      (existingGenerations ?? []).map((generation) =>
        generation.generated_text.trim().toLowerCase(),
      ),
    );
    const bulletsToInsert = selectedBullets
      .map((bullet) => bullet.trim())
      .filter((bullet) => !existingBulletTexts.has(bullet.toLowerCase()));

    if (bulletsToInsert.length) {
      const { error } = await admin.from("ai_generations").insert(
        bulletsToInsert.map((generatedText) => ({
          user_id: user.id,
          course_id: courseId,
          target_role: targetRole,
          prompt: `User-curated syllabus analysis for ${course.course_code} ${course.title}`,
          generated_text: generatedText,
          model_name: model,
          is_public: shareBullets,
        })),
      );
      if (error) {
        return NextResponse.json({ error: `Could not save selected bullets: ${error.message}` }, { status: 500 });
      }
      insertedBullets = bulletsToInsert.length;
    }
  }

  return NextResponse.json({
    insertedSkills,
    insertedBullets,
    sharedBullets: shareBullets ? insertedBullets : 0,
  });
}