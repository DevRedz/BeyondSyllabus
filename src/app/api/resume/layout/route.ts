import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import { createClient } from "../../../../lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECTIONS = new Set(["skills", "projects"]);
type Section = "skills" | "projects";
type LayoutEntry = { id: string; section: Section | null; position: number | null };

export async function PUT(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }

  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to save your resume layout." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The resume layout is invalid." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).items)) {
    return NextResponse.json({ error: "The resume layout is invalid." }, { status: 400 });
  }

  const rawItems = (body as { items: unknown[] }).items;
  if (rawItems.length > 500) {
    return NextResponse.json({ error: "A resume can contain at most 500 saved items." }, { status: 400 });
  }

  const entries: LayoutEntry[] = [];
  const ids = new Set<string>();
  for (const value of rawItems) {
    if (!value || typeof value !== "object") {
      return NextResponse.json({ error: "The resume layout contains an invalid item." }, { status: 400 });
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || !UUID_PATTERN.test(entry.id) || ids.has(entry.id)) {
      return NextResponse.json({ error: "The resume layout contains an invalid or repeated item." }, { status: 400 });
    }
    if (entry.section !== null && (typeof entry.section !== "string" || !SECTIONS.has(entry.section))) {
      return NextResponse.json({ error: "Choose Skills or Projects for each placed item." }, { status: 400 });
    }
    if (entry.position !== null && (typeof entry.position !== "number" || !Number.isInteger(entry.position) || entry.position < 0)) {
      return NextResponse.json({ error: "Resume positions must be nonnegative whole numbers." }, { status: 400 });
    }
    if ((entry.section === null) !== (entry.position === null)) {
      return NextResponse.json({ error: "Unplaced items cannot have a resume position." }, { status: 400 });
    }
    ids.add(entry.id);
    entries.push({
      id: entry.id,
      section: entry.section as Section | null,
      position: entry.position as number | null,
    });
  }

  for (const section of ["skills", "projects"] as const) {
    const positions = entries
      .filter((entry) => entry.section === section)
      .map((entry) => entry.position as number)
      .sort((left, right) => left - right);
    if (positions.some((position, index) => position !== index)) {
      return NextResponse.json({ error: "Resume positions must be consecutive within each section." }, { status: 400 });
    }
  }

  if (!entries.length) return NextResponse.json({ saved: 0 });

  const admin = getSupabase();
  const { data: ownedItems, error: ownedItemsError } = await admin
    .from("ai_generations")
    .select("id, item_type, resume_section, resume_position")
    .eq("user_id", user.id)
    .in("item_type", ["skill", "resume_bullet"])
    .in("id", entries.map((entry) => entry.id));
  if (ownedItemsError) {
    return NextResponse.json({ error: `Could not verify saved items: ${ownedItemsError.message}` }, { status: 500 });
  }
  if ((ownedItems ?? []).length !== entries.length) {
    return NextResponse.json({ error: "One or more items are not in your saved items." }, { status: 403 });
  }
  const ownedById = new Map((ownedItems ?? []).map((item) => [item.id, item]));
  if (entries.some((entry) => {
    const itemType = ownedById.get(entry.id)?.item_type;
    return entry.section !== null &&
      ((itemType === "skill" && entry.section !== "skills") ||
        (itemType === "resume_bullet" && entry.section !== "projects"));
  })) {
    return NextResponse.json({ error: "Skills belong in Skills, and resume bullets belong in Projects." }, { status: 400 });
  }

  const changedEntries = entries.filter((entry) => {
    const existing = ownedById.get(entry.id);
    return existing?.resume_section !== entry.section || existing?.resume_position !== entry.position;
  });

  for (let start = 0; start < changedEntries.length; start += 25) {
    const results = await Promise.all(changedEntries.slice(start, start + 25).map(async (entry) => {
      const { data, error } = await admin
        .from("ai_generations")
        .update({ resume_section: entry.section, resume_position: entry.position })
        .eq("id", entry.id)
        .eq("user_id", user.id)
        .in("item_type", ["skill", "resume_bullet"])
        .select("id")
        .maybeSingle();
      return { data, error };
    }));
    const failure = results.find((result) => result.error || !result.data);
    if (failure?.error) {
      return NextResponse.json({ error: `Could not save the resume layout: ${failure.error.message}` }, { status: 500 });
    }
    if (failure) {
      return NextResponse.json({ error: "A saved item changed while the resume was saving. Reload and try again." }, { status: 409 });
    }
  }

  return NextResponse.json({ saved: entries.length });
}
