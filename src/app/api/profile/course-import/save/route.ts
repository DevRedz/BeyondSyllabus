import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../../lib/supabase";
import { createClient } from "../../../../../lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMESTERS = ["Spring", "Summer", "Fall"] as const;

type CourseEntry = {
  courseId: string;
  year: number;
  semester: (typeof SEMESTERS)[number];
  section: string;
  offeringId: string | null;
};

type SectionSummary = {
  year: number;
  semester: string;
  section: string;
  professors: string[];
};

type CourseCatalogEntry = { id: string; course_code: string; title: string };

type ExistingHistoryEntry = {
  course_id: string;
  term_year: number;
  term_semester: string;
  section: string;
  offering_id: string | null;
  course_offerings: unknown;
};

function getProfessorNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(getProfessorNames);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") return [record.name];
  return Object.values(record).flatMap(getProfessorNames);
}

function currentTerm() {
  const now = new Date();
  const month = now.getMonth();
  return {
    year: now.getFullYear(),
    semester: month < 5 ? "Spring" : month < 8 ? "Summer" : "Fall",
  };
}

function termOrder(year: number, semester: string) {
  const rank = semester === "Spring" ? 0 : semester === "Summer" ? 1 : 2;
  return year * 3 + rank;
}

function statusForTerm(year: number, semester: string, now: { year: number; semester: string }) {
  const comparison = termOrder(year, semester) - termOrder(now.year, now.semester);
  return comparison < 0 ? "completed" : comparison === 0 ? "in_progress" : "planned";
}

function statusRank(value: string) {
  return value === "completed" ? 3 : value === "in_progress" ? 2 : 1;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to save your course history." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The course list is invalid." }, { status: 400 });
  }
  const entries = body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).courses)
    ? (body as { courses: unknown[] }).courses
    : [];
  const confirmExistingValue = body && typeof body === "object"
    ? (body as Record<string, unknown>).confirmExisting
    : undefined;
  if (confirmExistingValue !== undefined && typeof confirmExistingValue !== "boolean") {
    return NextResponse.json({ error: "The existing-course confirmation is invalid." }, { status: 400 });
  }
  const confirmExisting = confirmExistingValue === true;
  if (entries.length === 0 || entries.length > 150) {
    return NextResponse.json({ error: "Select between 1 and 150 matched courses." }, { status: 400 });
  }

  const parsed: CourseEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      return NextResponse.json({ error: "One or more course rows are invalid." }, { status: 400 });
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.courseId !== "string" || !UUID_PATTERN.test(row.courseId) ||
      typeof row.year !== "number" || !Number.isInteger(row.year) || row.year < 1900 || row.year > 2200 ||
      !SEMESTERS.includes(row.semester as CourseEntry["semester"]) ||
      typeof row.section !== "string" || row.section.length > 20 ||
      (row.offeringId !== null && (typeof row.offeringId !== "string" || !UUID_PATTERN.test(row.offeringId)))
    ) {
      return NextResponse.json({ error: "One or more course rows are invalid." }, { status: 400 });
    }
    parsed.push({
      courseId: row.courseId,
      year: row.year,
      semester: row.semester as CourseEntry["semester"],
      section: row.section.trim(),
      offeringId: row.offeringId as string | null,
    });
  }

  const admin = getSupabase();
  const uniqueCourseIds = Array.from(new Set(parsed.map((entry) => entry.courseId)));
  const uniqueOfferingIds = Array.from(new Set(parsed.flatMap((entry) => entry.offeringId ? [entry.offeringId] : [])));
  const [
    { data: catalog, error: catalogError },
    { data: offerings, error: offeringsError },
    { data: existingCourses, error: existingCoursesError },
    { data: existingHistory, error: existingHistoryError },
  ] = await Promise.all([
    admin.from("courses").select("id, course_code, title").in("id", uniqueCourseIds),
    uniqueOfferingIds.length
      ? admin.from("course_offerings")
          .select("id, course_id, year, semester, offering_sections(section), offering_professors(professors(name))")
          .in("id", uniqueOfferingIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("user_courses")
      .select("course_id, status")
      .eq("user_id", user.id)
      .in("course_id", uniqueCourseIds),
    admin.from("user_course_history")
      .select("course_id, term_year, term_semester, section, offering_id, course_offerings(offering_professors(professors(name)))")
      .eq("user_id", user.id)
      .in("course_id", uniqueCourseIds),
  ]);
  if (catalogError || offeringsError || existingCoursesError || existingHistoryError) {
    return NextResponse.json({ error: catalogError?.message ?? offeringsError?.message ?? existingCoursesError?.message ?? existingHistoryError?.message }, { status: 500 });
  }
  const catalogEntries = (catalog ?? []) as CourseCatalogEntry[];
  const catalogById = new Map(catalogEntries.map((course) => [course.id, course]));
  const catalogIds = new Set(catalogById.keys());
  if (parsed.some((entry) => !catalogIds.has(entry.courseId))) {
    return NextResponse.json({ error: "A selected course is no longer in the catalog. Reparse the file and try again." }, { status: 400 });
  }
  const offeringById = new Map((offerings ?? []).map((offering) => [offering.id, offering]));
  for (const entry of parsed) {
    if (!entry.offeringId) continue;
    const offering = offeringById.get(entry.offeringId);
    const sectionMatch = offering?.offering_sections.some((section) => section.section.trim().toLowerCase() === entry.section.toLowerCase());
    if (
      !offering || offering.course_id !== entry.courseId || offering.year !== entry.year ||
      offering.semester !== entry.semester || !sectionMatch
    ) {
      return NextResponse.json({ error: "A course section changed before saving. Reparse the file and try again." }, { status: 400 });
    }
  }

  const existingCourseIds = new Set((existingCourses ?? []).map((course) => course.course_id));
  const historyByCourse = new Map<string, ExistingHistoryEntry[]>();
  for (const row of (existingHistory ?? []) as ExistingHistoryEntry[]) {
    const rows = historyByCourse.get(row.course_id) ?? [];
    rows.push(row);
    historyByCourse.set(row.course_id, rows);
    existingCourseIds.add(row.course_id);
  }

  const incomingByCourse = new Map<string, CourseEntry[]>();
  for (const entry of parsed) {
    const rows = incomingByCourse.get(entry.courseId) ?? [];
    rows.push(entry);
    incomingByCourse.set(entry.courseId, rows);
  }

  const duplicateCourses = Array.from(incomingByCourse.entries())
    .filter(([courseId]) => existingCourseIds.has(courseId))
    .flatMap(([courseId, incomingRows]) => {
      const course = catalogById.get(courseId);
      if (!course) return [];
      const existingSections: SectionSummary[] = (historyByCourse.get(courseId) ?? []).map((row) => ({
        year: row.term_year,
        semester: row.term_semester,
        section: row.section,
        professors: Array.from(new Set(getProfessorNames(row.course_offerings))).sort(),
      }));
      const incomingSections: SectionSummary[] = incomingRows.map((row) => ({
        year: row.year,
        semester: row.semester,
        section: row.section,
        professors: row.offeringId
          ? Array.from(new Set(getProfessorNames(offeringById.get(row.offeringId)?.offering_professors))).sort()
          : [],
      }));
      return [{
        courseId,
        courseCode: course.course_code,
        courseTitle: course.title,
        existingSections,
        incomingSections,
      }];
    });

  if (duplicateCourses.length && !confirmExisting) {
    return NextResponse.json({ needsConfirmation: true, duplicates: duplicateCourses });
  }

  const nowTerm = currentTerm();
  const requestedStatus = new Map<string, string>();
  for (const entry of parsed) {
    const status = statusForTerm(entry.year, entry.semester, nowTerm);
    const existing = requestedStatus.get(entry.courseId);
    if (!existing || statusRank(status) > statusRank(existing)) requestedStatus.set(entry.courseId, status);
  }
  const existingStatus = new Map((existingCourses ?? []).map((row) => [row.course_id, row.status]));
  const courseRows = Array.from(requestedStatus, ([course_id, status]) => ({
    user_id: user.id,
    course_id,
    status: statusRank(existingStatus.get(course_id) ?? "planned") > statusRank(status)
      ? existingStatus.get(course_id)
      : status,
  }));

  const { error: historyError } = await admin.from("user_course_history").upsert(
    parsed.map((entry) => {
      const existingExactSection = (historyByCourse.get(entry.courseId) ?? []).find((history) =>
        history.term_year === entry.year &&
        history.term_semester === entry.semester &&
        history.section.trim().toLowerCase() === entry.section.trim().toLowerCase(),
      );
      return {
        user_id: user.id,
        course_id: entry.courseId,
        offering_id: entry.offeringId ?? existingExactSection?.offering_id ?? null,
        term_year: entry.year,
        term_semester: entry.semester,
        section: entry.section,
      };
    }),
    { onConflict: "user_id,course_id,term_year,term_semester,section" },
  );
  if (historyError) return NextResponse.json({ error: `Could not save course sections: ${historyError.message}` }, { status: 500 });

  const { error: coursesError } = await admin.from("user_courses").upsert(courseRows, { onConflict: "user_id,course_id" });
  if (coursesError) return NextResponse.json({ error: `Course sections were saved, but course status could not be updated: ${coursesError.message}` }, { status: 500 });

  return NextResponse.json({ saved: parsed.length });
}
