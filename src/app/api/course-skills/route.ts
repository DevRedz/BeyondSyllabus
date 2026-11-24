import { NextResponse } from "next/server";
import { getSupabase } from "../../../lib/supabase";
import { createClient } from "../../../lib/supabase/server";

type SkillRow = {
  id: string;
  course_id: string;
  skill_name: string;
  source_type: string;
  evidence: string | null;
  created_at: string;
  syllabi: unknown;
  courses: { course_code: string; title: string } | { course_code: string; title: string }[];
};

type GenerationRow = {
  id: string;
  course_id: string;
  offering_id: string | null;
  item_type: "skill" | "resume_bullet";
  generated_text: string | null;
  target_role: string;
  created_at: string;
  courses: { course_code: string; title: string } | { course_code: string; title: string }[];
  course_offerings: unknown;
};

type SkillVoteRow = { course_skill_id: string; user_id: string; vote: 1 | -1 };
type BulletVoteRow = { generation_id: string; user_id: string; vote_value: 1 | -1 };

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function namesIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(namesIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") return [record.name];
  return Object.values(record).flatMap(namesIn);
}

function getProfessors(value: unknown) {
  return Array.from(new Set(namesIn(value).map((name) => name.trim()).filter(Boolean)));
}

export async function GET() {
  const authClient = await createClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError && authError.name !== "AuthSessionMissingError") {
    return NextResponse.json(
      { error: `Could not verify your session: ${authError.message}` },
      { status: 500 },
    );
  }

  const admin = getSupabase();
  try {
    const [skills, skillVotes, generations, bulletVotes, completedCourses, allCompletedCourses] = await Promise.all([
      fetchAllRows<SkillRow>((from, to) =>
        admin
          .from("course_skills")
          .select("id, course_id, skill_name, source_type, evidence, created_at, syllabi(offering_id, course_offerings(year, semester, offering_professors(professors(name)))), courses!inner(course_code, title)")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<SkillVoteRow>((from, to) =>
        admin
          .from("course_skill_votes")
          .select("course_skill_id, user_id, vote")
          .order("course_skill_id")
          .range(from, to),
      ),
      fetchAllRows<GenerationRow>((from, to) =>
        admin
          .from("ai_generations")
          .select("id, course_id, offering_id, item_type, generated_text, target_role, created_at, courses!inner(course_code, title), course_offerings(year, semester, offering_professors(professors(name)))")
          .eq("is_public", true)
          .in("item_type", ["skill", "resume_bullet"])
          .not("generated_text", "is", null)
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<BulletVoteRow>((from, to) =>
        admin
          .from("votes")
          .select("generation_id, user_id, vote_value")
          .order("generation_id")
          .range(from, to),
      ),
      user
        ? admin
            .from("user_courses")
            .select("course_id")
            .eq("user_id", user.id)
            .eq("status", "completed")
            .then(({ data, error }) => {
              if (error) throw new Error(error.message);
              return data ?? [];
            })
        : Promise.resolve([]),
      fetchAllRows<{ user_id: string; course_id: string }>((from, to) =>
        admin
          .from("user_courses")
          .select("user_id, course_id")
          .eq("status", "completed")
          .order("course_id")
          .range(from, to),
      ),
    ]);

    const skillCourseIds = new Map(skills.map((skill) => [skill.id, skill.course_id]));
    const bullets = generations.filter((item) => item.item_type === "resume_bullet");
    const sharedSkillProfessors = new Map<string, Set<string>>();
    for (const generation of generations) {
      if (generation.item_type !== "skill" || !generation.generated_text) continue;
      const key = `${generation.course_id}|${generation.generated_text.trim().toLowerCase()}`;
      const professors = sharedSkillProfessors.get(key) ?? new Set<string>();
      getProfessors(generation.course_offerings).forEach((name) => professors.add(name));
      sharedSkillProfessors.set(key, professors);
    }
    const bulletCourseIds = new Map(bullets.map((bullet) => [bullet.id, bullet.course_id]));
    const eligibleVoters = new Map<string, Set<string>>();
    for (const course of allCompletedCourses) {
      const voters = eligibleVoters.get(course.course_id) ?? new Set<string>();
      voters.add(course.user_id);
      eligibleVoters.set(course.course_id, voters);
    }
    const completedCourseIds = new Set(completedCourses.map((course) => course.course_id));
    const skillSummaries = new Map<string, { upvotes: number; downvotes: number; userVote: 1 | -1 | null }>();
    for (const vote of skillVotes) {
      const courseId = skillCourseIds.get(vote.course_skill_id);
      if (!courseId || !eligibleVoters.get(courseId)?.has(vote.user_id)) continue;
      const summary = skillSummaries.get(vote.course_skill_id) ?? { upvotes: 0, downvotes: 0, userVote: null };
      if (vote.vote === 1) summary.upvotes += 1;
      else summary.downvotes += 1;
      if (vote.user_id === user?.id) summary.userVote = vote.vote;
      skillSummaries.set(vote.course_skill_id, summary);
    }

    const bulletSummaries = new Map<string, { upvotes: number; downvotes: number; userVote: 1 | -1 | null }>();
    for (const vote of bulletVotes) {
      const courseId = bulletCourseIds.get(vote.generation_id);
      if (!courseId || !eligibleVoters.get(courseId)?.has(vote.user_id)) continue;
      const summary = bulletSummaries.get(vote.generation_id) ?? { upvotes: 0, downvotes: 0, userVote: null };
      if (vote.vote_value === 1) summary.upvotes += 1;
      else summary.downvotes += 1;
      if (vote.user_id === user?.id) summary.userVote = vote.vote_value;
      bulletSummaries.set(vote.generation_id, summary);
    }

    return NextResponse.json({
      completedCourseIds: Array.from(completedCourseIds),
      skills: skills.map((skill) => {
        const course = first(skill.courses)!;
        const summary = skillSummaries.get(skill.id);
        return {
          id: skill.id,
          kind: "skill" as const,
          courseId: skill.course_id,
          courseCode: course.course_code,
          courseTitle: course.title,
          professors: Array.from(new Set([
            ...getProfessors(skill.syllabi),
            ...Array.from(
              sharedSkillProfessors.get(`${skill.course_id}|${skill.skill_name.trim().toLowerCase()}`) ?? [],
            ),
          ])),
          name: skill.skill_name,
          sourceType: skill.source_type,
          evidence: skill.evidence,
          createdAt: skill.created_at,
          upvotes: summary?.upvotes ?? 0,
          downvotes: summary?.downvotes ?? 0,
          userVote: summary?.userVote ?? null,
          canVote: completedCourseIds.has(skill.course_id),
        };
      }),
      resumeBullets: bullets.map((bullet) => {
        const course = first(bullet.courses)!;
        const summary = bulletSummaries.get(bullet.id);
        return {
          id: bullet.id,
          kind: "resume_bullet" as const,
          courseId: bullet.course_id,
          courseCode: course.course_code,
          courseTitle: course.title,
          professors: getProfessors(bullet.course_offerings),
          name: bullet.generated_text!,
          targetRole: bullet.target_role,
          createdAt: bullet.created_at,
          upvotes: summary?.upvotes ?? 0,
          downvotes: summary?.downvotes ?? 0,
          userVote: summary?.userVote ?? null,
          canVote: completedCourseIds.has(bullet.course_id),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not load course skills: ${
          error instanceof Error ? error.message : "Unexpected database error."
        }`,
      },
      { status: 500 },
    );
  }
}
