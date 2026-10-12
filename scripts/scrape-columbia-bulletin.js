const cheerio = require("cheerio");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const BULLETIN_SCHOOLS = {
  college: {
    root: "https://bulletin.columbia.edu/columbia-college/departments-instruction/",
    departmentPrefix: "",
    excludedSlugs: new Set(["search"]),
  },
  engineering: {
    root: "https://bulletin.columbia.edu/columbia-engineering/academic-departments-programs/",
    departmentPrefix: "ENG_",
    excludedSlugs: new Set(["key-course-listings", "undergraduate-minors"]),
  },
};
const REQUEST_DELAY_MS = 350;
const BATCH_SIZE = 100;
const PAGE_SIZE = 1000;

function normalizeText(value) {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chunk(items, size = BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parseAcademicYear(text) {
  const match = text.match(/\b(20\d{2})\s*[-–]\s*(20\d{2})\s+Bulletin\b/i);
  return match ? `${match[1]}-${match[2]}` : null;
}

function academicYearForTerm(semester, year) {
  return semester === "Fall" ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function parseTerm(text) {
  const match = normalizeText(text).match(/\b(Spring|Summer|Fall)\s+(20\d{2})\b/i);
  if (!match) return null;

  const semester = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  return { semester, year: Number(match[2]) };
}

function parseCourseTitle(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /^([A-Z][A-Z0-9&-]*(?:\s+[A-Z]{1,3})?\s*\d{4}[A-Z]?)\s+(.+)$/,
  );
  if (!match) return null;

  return {
    courseCode: normalizeText(match[1]),
    title: normalizeText(match[2]).replace(/[.]$/, ""),
  };
}

function parseSectionAndCallNumber(value) {
  const normalized = normalizeText(value);
  const match = normalized.match(/^(.+?)\s*\/\s*(\d+)$/);
  return match
    ? { section: normalizeText(match[1]), callNumber: match[2] }
    : { section: normalized, callNumber: null };
}

function parseScheduleLocation($, cell) {
  const html = $(cell).html() ?? "";
  const parts = html
    .split(/<br\s*\/?>/i)
    .map((part) => normalizeText(cheerio.load(part).root().text()))
    .filter(Boolean);

  return {
    schedule: parts[0] ?? null,
    location: parts.slice(1).join("; ") || null,
  };
}

function getCellText($, row, headers, expression) {
  const index = headers.findIndex((header) => expression.test(header));
  if (index < 0) return "";
  return normalizeText($(row).children("td").eq(index).text());
}

function parseCourseBlock($, block, department, sourceUrl, bulletinYear) {
  const titleLine = $(block).find(".courseblocktitle strong").first().text();
  const parsedTitle = parseCourseTitle(titleLine);
  if (!parsedTitle) return { course: null, offerings: [] };

  const description = normalizeText(
    $(block).find(".courseblockdesc").first().text(),
  );
  const topicParagraph = $(block)
    .find("p")
    .toArray()
    .map((paragraph) => normalizeText($(paragraph).text()))
    .find((text) => /^topic(?:\s+title)?\s*:/i.test(text));
  const topicTitle = topicParagraph
    ? normalizeText(
        topicParagraph.replace(/^topic(?:\s+title)?\s*:\s*/i, ""),
      ).replace(/[.]$/, "") || null
    : null;
  const prerequisites = $(block)
    .find("p")
    .toArray()
    .map((paragraph) => normalizeText($(paragraph).text()))
    .find((text) => /^prerequisites?\s*:/i.test(text));
  const pointsText = $(block).find(".courseblocktitle em").first().text();
  const creditsMatch = pointsText.match(/([\d.]+)\s*points?/i);
  const course = {
    ...parsedTitle,
    departmentCode: department.code,
    academicYear: bulletinYear,
    description: description || null,
    prerequisites: prerequisites
      ? prerequisites.replace(/^prerequisites?\s*:\s*/i, "") || null
      : null,
    credits: creditsMatch ? Number(creditsMatch[1]) : null,
    sourceUrl,
  };
  const offerings = [];

  $(block)
    .find("table.scheduletbl")
    .each((_, table) => {
      let term = null;
      let headers = [];

      $(table)
        .find("tr")
        .each((__, row) => {
          const headerCells = $(row).find("th");
          if (headerCells.length) {
            headers = headerCells
              .toArray()
              .map((cell) => normalizeText($(cell).text()).toLowerCase());
            return;
          }

          const cells = $(row).children("td");
          if (!cells.length) return;

          const termCell = $(row).find(".unifyTerm");
          if (termCell.length) {
            term = parseTerm(termCell.text());
            return;
          }

          if (!headers.length || !term) return;

          const sectionAndCall = getCellText(
            $,
            row,
            headers,
            /section\s*\/\s*call\s*number/i,
          );
          const { section, callNumber } =
            parseSectionAndCallNumber(sectionAndCall);
          if (!section) return;

          const scheduleIndex = headers.findIndex((header) =>
            /times\s*\/\s*location/i.test(header),
          );
          const scheduleLocation =
            scheduleIndex < 0
              ? { schedule: null, location: null }
              : parseScheduleLocation(
                  $,
                  $(row).children("td").get(scheduleIndex),
                );
          const professor = getCellText(
            $,
            row,
            headers,
            /^instructor$/i,
          );

          offerings.push({
            courseCode: parsedTitle.courseCode,
            semester: term.semester,
            year: term.year,
            section,
            call_number: callNumber,
            professor: professor || null,
            schedule: scheduleLocation.schedule,
            location: scheduleLocation.location,
            source_url: sourceUrl,
            topicTitle,
          });
        });
    });

  if (!bulletinYear && offerings.length) {
    course.academicYear = academicYearForTerm(
      offerings[0].semester,
      offerings[0].year,
    );
  }

  return { course, offerings };
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "HumorProjectCourseCatalog/1.0" },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

async function discoverDepartments(school) {
  const config = BULLETIN_SCHOOLS[school];
  const html = await fetchHtml(config.root);
  const $ = cheerio.load(html);
  const departments = new Map();
  const basePath = new URL(config.root).pathname;

  $("a[href]").each((_, anchor) => {
    const url = new URL($(anchor).attr("href"), config.root);
    if (!url.pathname.startsWith(basePath)) return;

    const slug = url.pathname.slice(basePath.length).replace(/\/$/, "");
    if (!slug || slug.includes("/") || config.excludedSlugs.has(slug)) return;
    if (!departments.has(slug)) {
      departments.set(slug, {
        slug,
        name: normalizeText($(anchor).text()),
        code: `${config.departmentPrefix}${slug.toUpperCase().replace(/-/g, "_")}`,
        url: new URL(`${slug}/`, config.root).href,
      });
    }
  });

  return [...departments.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function parseArguments(args) {
  const options = {
    write: false,
    department: null,
    limit: null,
    school: "college",
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--write") options.write = true;
    else if (args[index] === "--school") {
      options.school = args[index + 1];
      index += 1;
    } else if (args[index] === "--department") {
      options.department = args[index + 1];
      index += 1;
    } else if (args[index] === "--limit") {
      options.limit = Number(args[index + 1]);
      index += 1;
    } else if (args[index] === "--help") {
      console.log(
        "Usage: npm run scrape:bulletin -- [--school college|engineering] [--department slug] [--limit number] [--write]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }

  if (!Object.hasOwn(BULLETIN_SCHOOLS, options.school)) {
    throw new Error("--school must be college or engineering.");
  }
  if (options.department && !/^[a-z0-9-]+$/i.test(options.department)) {
    throw new Error("Department must be the URL slug, such as anthropology.");
  }
  if (
    options.limit !== null &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  ) {
    throw new Error("--limit must be a positive integer.");
  }

  return options;
}

async function collect(options) {
  let departments = await discoverDepartments(options.school);
  if (options.department) {
    departments = departments.filter(
      (department) => department.slug === options.department,
    );
    if (!departments.length) {
      throw new Error(`Department not found: ${options.department}`);
    }
  }
  if (options.limit) departments = departments.slice(0, options.limit);

  const courses = new Map();
  const offerings = new Map();
  const failures = [];
  let bulletinYear = null;

  for (const [index, department] of departments.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }

    try {
      const html = await fetchHtml(department.url);
      const $ = cheerio.load(html);
      bulletinYear = bulletinYear ?? parseAcademicYear($("body").text());
      const courseContainer = $("#coursestextcontainer");
      if (!courseContainer.length) {
        console.log(`${department.name}: no course listing tab; skipping course records`);
        continue;
      }

      courseContainer.find(".courseblock").each((_, block) => {
        const parsed = parseCourseBlock(
          $,
          block,
          department,
          `${department.url}#coursestext`,
          bulletinYear,
        );
        if (!parsed.course) return;
        if (!courses.has(parsed.course.courseCode)) {
          courses.set(parsed.course.courseCode, parsed.course);
        }
        for (const offering of parsed.offerings) {
          const key = [
            offering.courseCode,
            offering.semester,
            offering.year,
            offering.section,
            offering.call_number ?? "",
            offering.topicTitle ?? "",
          ].join("|");
          if (!offerings.has(key)) offerings.set(key, offering);
        }
      });
      console.log(`${department.name}: parsed ${courseContainer.find(".courseblock").length} course entries`);
    } catch (error) {
      failures.push(`${department.name}: ${error.message}`);
    }
  }

  if (failures.length) {
    throw new Error(`Some department pages could not be collected:\n${failures.join("\n")}`);
  }

  return {
    departments,
    courses: [...courses.values()],
    offerings: [...offerings.values()],
    bulletinYear: bulletinYear ?? "unknown",
  };
}

function assertSuccess(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

async function fetchCourseIds(supabase, courseCodes) {
  const courseIds = new Map();
  for (const codes of chunk(courseCodes)) {
    const rows = assertSuccess(
      await supabase
        .from("courses")
        .select("id, course_code")
        .in("course_code", codes),
      "Loading courses",
    );
    for (const row of rows) courseIds.set(row.course_code, row.id);
  }
  return courseIds;
}

async function fetchRowsByIds(supabase, table, columns, idColumn, ids) {
  const rows = [];
  for (const idBatch of chunk(ids)) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = assertSuccess(
        await supabase
          .from(table)
          .select(columns)
          .in(idColumn, idBatch)
          .range(offset, offset + PAGE_SIZE - 1),
        `Loading ${table}`,
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

function normalizeProfessorName(name) {
  return normalizeText(name).replace(/\s+/g, " ").toLowerCase();
}

function splitProfessorNames(value) {
  const normalized = normalizeText(value);
  if (!normalized || /^(?:TBA|staff|to be announced)$/i.test(normalized)) {
    return [];
  }

  return normalized
    .split(/\s*(?:,|;|\band\b)\s*/i)
    .map(normalizeText)
    .filter(Boolean);
}

async function ensureProfessors(supabase, names) {
  const uniqueNames = new Map(
    names
      .filter(Boolean)
      .map((name) => [normalizeProfessorName(name), normalizeText(name)]),
  );
  if (!uniqueNames.size) return new Map();

  let rows = [];
  for (const normalizedNames of chunk([...uniqueNames.keys()])) {
    rows.push(
      ...assertSuccess(
        await supabase
          .from("professors")
          .select("id, normalized_name")
          .in("normalized_name", normalizedNames),
        "Loading professors",
      ),
    );
  }
  const professorIds = new Map(
    rows.map((row) => [row.normalized_name, row.id]),
  );
  const missing = [...uniqueNames]
    .filter(([normalizedName]) => !professorIds.has(normalizedName))
    .map(([, name]) => ({ name }));

  for (const batch of chunk(missing)) {
    assertSuccess(
      await supabase
        .from("professors")
        .upsert(batch, {
          onConflict: "normalized_name",
          ignoreDuplicates: true,
        }),
      "Saving professors",
    );
  }

  rows = [];
  for (const normalizedNames of chunk([...uniqueNames.keys()])) {
    rows.push(
      ...assertSuccess(
        await supabase
          .from("professors")
          .select("id, normalized_name")
          .in("normalized_name", normalizedNames),
        "Loading saved professors",
      ),
    );
  }
  const resolvedProfessorIds = new Map(
    rows.map((row) => [row.normalized_name, row.id]),
  );
  const unresolved = [...uniqueNames.keys()].filter(
    (normalizedName) => !resolvedProfessorIds.has(normalizedName),
  );
  if (unresolved.length) {
    throw new Error(
      `Could not resolve professor IDs for: ${unresolved.join(", ")}`,
    );
  }
  return resolvedProfessorIds;
}

async function writeData(data) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY in .env.",
    );
  }

  const supabase = createClient(supabaseUrl, secretKey);
  const departmentIds = new Map();
  for (const batch of chunk(data.departments)) {
    const rows = assertSuccess(
      await supabase
        .from("departments")
        .upsert(
          batch.map(({ name, code, url }) => ({
            name,
            code,
            bulletin_url: url,
          })),
          { onConflict: "code" },
        )
        .select("id, code"),
      "Saving departments",
    );
    for (const row of rows) departmentIds.set(row.code, row.id);
  }

  let courseIds = await fetchCourseIds(
    supabase,
    data.courses.map((course) => course.courseCode),
  );
  const newCourses = data.courses.filter(
    (course) => !courseIds.has(course.courseCode),
  );
  for (const batch of chunk(newCourses)) {
    assertSuccess(
      await supabase.from("courses").upsert(
        batch.map((course) => ({
          department_id: departmentIds.get(course.departmentCode),
          course_code: course.courseCode,
          title: course.title,
        })),
        { onConflict: "course_code", ignoreDuplicates: true },
      ),
      "Saving courses",
    );
  }
  courseIds = await fetchCourseIds(
    supabase,
    data.courses.map((course) => course.courseCode),
  );

  const catalogRows = data.courses
    .map((course) => ({
      course_id: courseIds.get(course.courseCode),
      academic_year: course.academicYear,
      description: course.description,
      prerequisites: course.prerequisites,
      credits: course.credits,
      source_url: course.sourceUrl,
    }))
    .filter((row) => row.course_id && row.academic_year !== "unknown");
  const existingCatalog = await fetchRowsByIds(
    supabase,
    "course_catalog_versions",
    "id, course_id, academic_year",
    "course_id",
    [...new Set(catalogRows.map((row) => row.course_id))],
  );
  const catalogByKey = new Map(
    existingCatalog.map((row) => [`${row.course_id}|${row.academic_year}`, row.id]),
  );
  const newCatalog = [];
  const catalogUpdates = [];
  for (const row of catalogRows) {
    const id = catalogByKey.get(`${row.course_id}|${row.academic_year}`);
    if (id) catalogUpdates.push({ id, row });
    else newCatalog.push(row);
  }
  for (const batch of chunk(newCatalog)) {
    assertSuccess(
      await supabase.from("course_catalog_versions").insert(batch),
      "Saving catalog versions",
    );
  }
  for (const batch of chunk(catalogUpdates, 10)) {
    await Promise.all(
      batch.map(async ({ id, row }) =>
        assertSuccess(
          await supabase
            .from("course_catalog_versions")
            .update(row)
            .eq("id", id),
          "Updating catalog versions",
        ),
      ),
    );
  }

  const sectionRows = data.offerings
    .map((offering) => ({
      course_id: courseIds.get(offering.courseCode),
      semester: offering.semester,
      year: offering.year,
      section: offering.section,
      professorNames: splitProfessorNames(offering.professor),
      call_number: offering.call_number,
      schedule: offering.schedule,
      location: offering.location,
      source_url: offering.source_url,
      topic_title: offering.topicTitle,
    }))
    .filter((row) => row.course_id);
  const professorNames = [
    ...new Set(sectionRows.flatMap((section) => section.professorNames)),
  ];
  const professorIds = await ensureProfessors(supabase, professorNames);
  const offeringIds = new Set();

  for (const batch of chunk(sectionRows, 10)) {
    const results = await Promise.all(
      batch.map(async (section) => {
        const professorIdsForSection = section.professorNames
          .map((name) => professorIds.get(normalizeProfessorName(name)))
          .filter(Boolean);
        const { data: offeringId, error } = await supabase.rpc(
          "get_or_create_offering",
          {
            p_course_id: section.course_id,
            p_semester: section.semester,
            p_year: section.year,
            p_professor_ids: professorIdsForSection,
            p_section: section.section,
            p_call_number: section.call_number,
            p_schedule: section.schedule,
            p_location: section.location,
            p_source_url: section.source_url,
            p_topic_title: section.topic_title,
          },
        );
        if (error) {
          throw new Error(
            `Offering RPC failed for ${section.course_id} ${section.semester} ${section.year} section ${section.section}: ${error.message}`,
          );
        }
        if (!offeringId) {
          throw new Error(
            `Offering RPC returned no id for ${section.course_id} section ${section.section}.`,
          );
        }
        return offeringId;
      }),
    );
    for (const offeringId of results) offeringIds.add(offeringId);
  }

  return {
    departments: data.departments.length,
    courses: data.courses.length,
    catalogVersions: catalogRows.length,
    offerings: offeringIds.size,
    offeringSections: sectionRows.length,
    professors: professorNames.size,
    insertedCatalogVersions: newCatalog.length,
    offeringRpcCalls: sectionRows.length,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const data = await collect(options);
  console.log(`\nBulletin year: ${data.bulletinYear}`);
  console.log(`School: ${options.school}`);
  console.log(
    `Collected ${data.departments.length} departments, ${data.courses.length} unique courses, and ${data.offerings.length} offerings.`,
  );
  console.log("Offering samples:", JSON.stringify(data.offerings.slice(0, 3), null, 2));
  const topicSamples = data.offerings.filter((offering) => offering.topicTitle);
  if (topicSamples.length) {
    console.log("Topic samples:", JSON.stringify(topicSamples.slice(0, 3), null, 2));
  }

  if (!options.write) {
    console.log("\nPreview only. Add --write to save these records to Supabase.");
    return;
  }

  const result = await writeData(data);
  console.log("\nSupabase sync complete:", JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});