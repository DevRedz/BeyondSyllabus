import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import { createClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 4 * 1024 * 1024;

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
    return NextResponse.json({ error: "Sign in to analyze a syllabus." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The AI service is not configured. Add OPENAI_API_KEY to the server environment." },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload a syllabus PDF to continue." }, { status: 400 });
  }

  const courseId = String(formData.get("courseId") ?? "");
  const syllabusFile = formData.get("syllabus");

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(courseId)) {
    return NextResponse.json({ error: "Choose a valid course." }, { status: 400 });
  }
  if (!(syllabusFile instanceof File) || syllabusFile.size === 0) {
    return NextResponse.json({ error: "Choose a syllabus PDF." }, { status: 400 });
  }
  if (
    syllabusFile.type !== "application/pdf" ||
    !syllabusFile.name.toLowerCase().endsWith(".pdf")
  ) {
    return NextResponse.json(
      { error: "Upload a PDF file." },
      { status: 415 },
    );
  }
  if (syllabusFile.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "The PDF must be 4 MB or smaller." }, { status: 413 });
  }

  const pdfBytes = Buffer.from(await syllabusFile.arrayBuffer());
  if (!pdfBytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 415 });
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

  const pdfBase64 = pdfBytes.toString("base64");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      text: {
        format: {
          type: "json_schema",
          name: "course_resume_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["course_name", "source_readable", "skillsets", "resume_bullets"],
            properties: {
              course_name: { type: "string" },
              source_readable: { type: "boolean" },
              skillsets: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["category", "skills"],
                  properties: {
                    category: { type: "string" },
                    skills: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["name", "evidence"],
                        properties: {
                          name: { type: "string" },
                          evidence: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
              resume_bullets: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "First decide whether the document is a readable syllabus or course outline and set source_readable accordingly. If it is not, return an empty skillsets array and an empty resume_bullets array. If it is readable, extract only skills and accomplishments supported by it. Do not invent technologies, projects, outcomes, or experience. Return up to 3 skill categories, no more than 4 concise skills per category, each with a short evidence quote or explanation. Return exactly 5 distinct, conservative resume bullets grounded in the syllabus; do not imply the student completed work not shown.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Analyze this syllabus PDF for ${course.course_code}: ${course.title}. Use only evidence in the document.`,
            },
            {
              type: "input_file",
              filename: "syllabus.pdf",
              file_data: `data:application/pdf;base64,${pdfBase64}`,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!openaiResponse.ok) {
    const errorBody = (await openaiResponse.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    return NextResponse.json(
      { error: errorBody?.error?.message ?? "The AI service could not analyze this PDF." },
      { status: openaiResponse.status === 429 ? 429 : 502 },
    );
  }

  const completion = (await openaiResponse.json()) as {
    output?: Array<{
      content?: Array<{ type?: string; text?: string; refusal?: string }>;
    }>;
  };
  const outputContent = completion.output?.flatMap((item) => item.content ?? []) ?? [];
  const refusal = outputContent.find((item) => item.type === "refusal")?.refusal;
  const responseText = outputContent
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
  if (!responseText || refusal) {
    return NextResponse.json(
      { error: refusal ?? "The AI service returned no analysis." },
      { status: 422 },
    );
  }

  try {
    const analysis: unknown = JSON.parse(responseText);
    if (!analysis || typeof analysis !== "object") {
      throw new Error("Invalid analysis object");
    }
    const result = analysis as Record<string, unknown>;
    if (typeof result.source_readable !== "boolean") {
      throw new Error("Missing source readability result");
    }
    if (!result.source_readable) {
      return NextResponse.json(
        { error: "This PDF does not appear to be a readable syllabus or course outline." },
        { status: 422 },
      );
    }
    const skillsets = result.skillsets;
    const bullets = result.resume_bullets;
    const validSkillsets =
      Array.isArray(skillsets) &&
      skillsets.length <= 3 &&
      skillsets.every(
        (category) =>
          category &&
          typeof category === "object" &&
          typeof category.category === "string" &&
          Array.isArray(category.skills) &&
          category.skills.length > 0 &&
          category.skills.length <= 4 &&
          category.skills.every((skill: unknown) => {
            if (!skill || typeof skill !== "object") return false;
            const skillRecord = skill as Record<string, unknown>;
            return (
              typeof skillRecord.name === "string" &&
              typeof skillRecord.evidence === "string"
            );
          }),
      );
    if (
      typeof result.course_name !== "string" ||
      !validSkillsets ||
      !Array.isArray(bullets) ||
      bullets.length !== 5 ||
      !bullets.every((bullet) => typeof bullet === "string")
    ) {
      throw new Error("Analysis exceeded or failed the requested output limits");
    }
    const validatedAnalysis = {
      course_name: result.course_name,
      source_readable: true,
      skillsets,
      resume_bullets: bullets,
    };
    return NextResponse.json({ analysis: validatedAnalysis, model });
  } catch {
    return NextResponse.json({ error: "The AI service returned invalid structured data." }, { status: 502 });
  }
}