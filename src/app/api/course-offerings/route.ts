import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../lib/supabase";

export async function GET(request: NextRequest) {
  const courseId = request.nextUrl.searchParams.get("courseId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(courseId)) {
    return NextResponse.json({ error: "Choose a valid course." }, { status: 400 });
  }

  const { data: offerings, error } = await getSupabase()
    .from("course_offerings")
    .select("id, semester, year, offering_professors(professors(name)), syllabi(id)")
    .eq("course_id", courseId)
    .order("year", { ascending: false })
    .order("semester");

  if (error) {
    return NextResponse.json(
      { error: `Could not load course offerings: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    offerings: (offerings ?? []).map((offering) => ({
      id: offering.id,
      semester: offering.semester,
      year: offering.year,
      professors: Array.from(
        new Set(
          offering.offering_professors
            .flatMap((link) => {
              const relation: unknown = link.professors;
              const relatedProfessors = Array.isArray(relation)
                ? relation
                : relation
                  ? [relation]
                  : [];
              return relatedProfessors.flatMap((professor: unknown) =>
                professor &&
                typeof professor === "object" &&
                "name" in professor &&
                typeof professor.name === "string"
                  ? [professor.name]
                  : [],
              );
            })
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort(),
      has_syllabus: offering.syllabi.length > 0,
    })),
  });
}
