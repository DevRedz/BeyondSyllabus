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
  courses: { course_code: string; title: string } | { course_code: string; title: string }[];
};

type VoteRow = {
  course_skill_id: string;
  user_id: string;
  vote: 1 | -1;
};

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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
    const [skills, votes] = await Promise.all([
      fetchAllRows<SkillRow>((from, to) =>
        admin
          .from("course_skills")
          .select("id, course_id, skill_name, source_type, evidence, created_at, courses!inner(course_code, title)")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<VoteRow>((from, to) =>
        admin
          .from("course_skill_votes")
          .select("course_skill_id, user_id, vote")
          .order("course_skill_id")
          .range(from, to),
      ),
    ]);

    const summaries = new Map<
      string,
      { upvotes: number; downvotes: number; userVote: 1 | -1 | null }
    >();
    for (const vote of votes) {
      const summary = summaries.get(vote.course_skill_id) ?? {
        upvotes: 0,
        downvotes: 0,
        userVote: null,
      };
      if (vote.vote === 1) summary.upvotes += 1;
      else summary.downvotes += 1;
      if (vote.user_id === user?.id) summary.userVote = vote.vote;
      summaries.set(vote.course_skill_id, summary);
    }

    return NextResponse.json({
      skills: skills.map((skill) => {
        const course = Array.isArray(skill.courses) ? skill.courses[0] : skill.courses;
        const summary = summaries.get(skill.id);
        return {
          id: skill.id,
          courseId: skill.course_id,
          courseCode: course.course_code,
          courseTitle: course.title,
          name: skill.skill_name,
          sourceType: skill.source_type,
          evidence: skill.evidence,
          createdAt: skill.created_at,
          upvotes: summary?.upvotes ?? 0,
          downvotes: summary?.downvotes ?? 0,
          userVote: summary?.userVote ?? null,
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
