"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ParsedCourse = {
  key: string;
  course_code: string;
  course_title: string;
  section: string;
  semester: string;
  year: number;
  courseId: string | null;
  catalogCode: string | null;
  catalogTitle: string | null;
  offeringId: string | null;
  professors: string[];
};

type SectionSummary = {
  year: number;
  semester: string;
  section: string;
  professors: string[];
};

type DuplicateCourse = {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  existingSections: SectionSummary[];
  incomingSections: SectionSummary[];
};

const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export default function CourseHistoryImport() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [courses, setCourses] = useState<ParsedCourse[]>([]);
  const [duplicateCourses, setDuplicateCourses] = useState<DuplicateCourse[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const duplicateDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = duplicateDialogRef.current;
    if (!dialog) return;
    if (duplicateCourses?.length && !dialog.open) dialog.showModal();
    else if (!duplicateCourses && dialog.open) dialog.close();
  }, [duplicateCourses]);

  async function parseFiles() {
    if (!files.length) {
      setError("Choose a transcript PDF or one or more screenshots first.");
      return;
    }
    if (files.length > MAX_UPLOAD_FILES) {
      setError(`Choose no more than ${MAX_UPLOAD_FILES} files at a time.`);
      return;
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      setError("Each file must be 8 MB or smaller.");
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_BYTES) {
      setError("The selected files must total 24 MB or less.");
      return;
    }
    setError("");
    setMessage("");
    setCourses([]);
    setSelectedKeys(new Set());
    setIsParsing(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const response = await fetch("/api/profile/course-import/parse", { method: "POST", body: formData });
      const result = await response.json() as { courses?: ParsedCourse[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not read course history.");
      const rows = result.courses ?? [];
      setCourses(rows);
      setSelectedKeys(new Set(rows.filter((row) => row.courseId).map((row) => row.key)));
      if (!rows.length) setMessage("No course rows were recognized in these files.");
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not read course history.");
    } finally {
      setIsParsing(false);
    }
  }

  async function saveCourses(confirmExisting = false) {
    const selected = courses.filter((course) => course.courseId && selectedKeys.has(course.key));
    if (!selected.length) {
      setError("Select at least one matched course to save.");
      return;
    }
    setError("");
    setMessage("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/profile/course-import/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmExisting,
          courses: selected.map((course) => ({
            courseId: course.courseId,
            year: course.year,
            semester: course.semester,
            section: course.section,
            offeringId: course.offeringId,
          })),
        }),
      });
      const result = await response.json() as {
        saved?: number;
        error?: string;
        needsConfirmation?: boolean;
        duplicates?: DuplicateCourse[];
      };
      if (!response.ok) throw new Error(result.error ?? "Could not save course history.");
      if (result.needsConfirmation && result.duplicates?.length) {
        setDuplicateCourses(result.duplicates);
        return;
      }
      setMessage(`Saved ${result.saved ?? selected.length} course records to your profile.`);
      setCourses([]);
      setDuplicateCourses(null);
      setSelectedKeys(new Set());
      setFiles([]);
      router.refresh();
    } catch (saveError) {
      if (confirmExisting) setDuplicateCourses(null);
      setError(saveError instanceof Error ? saveError.message : "Could not save course history.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="course-history-import">
      <div className="course-history-import-heading">
        <div>
          <h3>Add courses in bulk</h3>
          <p>Import course terms and sections from a transcript or multiple Vergil screenshots.</p>
        </div>
        <button className="secondary-action" type="button" onClick={() => setIsOpen((open) => !open)}>
          {isOpen ? "Close import" : "Import courses"}
        </button>
      </div>

      {isOpen ? (
        <div className="course-history-import-panel">
          <div className="course-import-file-label">
            <label htmlFor="course-history-file">Transcript PDF or screenshots</label>
            <span className="course-import-help-wrap">
              <button className="course-import-help" type="button" aria-label="Screenshot instructions">i</button>
              <span className="course-import-tooltip" role="tooltip">
                In Vergil, expand each term and capture the table columns for term, course, section, and title. Select multiple screenshots together if you have several terms. Crop out your name, grades, GPA, and ID. Use screenshots if you don’t want grade information included; transcript PDFs may contain grades.
              </span>
            </span>
          </div>
          <input
            id="course-history-file"
            type="file"
            multiple
            disabled={isParsing || isSaving}
            accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"
            onChange={(event) => {
              const selectedFiles = Array.from(event.target.files ?? []);
              setFiles(selectedFiles);
              setCourses([]);
              setSelectedKeys(new Set());
              setError(selectedFiles.length > MAX_UPLOAD_FILES
                ? `Choose no more than ${MAX_UPLOAD_FILES} files at a time.`
                : selectedFiles.some((file) => file.size > MAX_FILE_BYTES)
                  ? "Each file must be 8 MB or smaller."
                  : selectedFiles.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_BYTES
                    ? "The selected files must total 24 MB or less."
                    : "");
              setMessage("");
              event.currentTarget.value = "";
            }}
          />
          <p className="course-import-file-note">Choose up to 10 files, 8 MB each and 24 MB total. Screenshots can cover different terms; select them together before reading the list.</p>
          {files.length ? (
            <ul className="course-import-selected-files" aria-label="Selected files">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.lastModified}-${index}`}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    disabled={isParsing || isSaving}
                    onClick={() => {
                      setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
                      setError("");
                    }}
                    aria-label={`Remove ${file.name}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="course-import-privacy">
            Selected files are sent to the course extraction service and are not stored by Beyond Syllabus. Only the courses you select, their term and section, and a matched offering are saved.
          </p>
          <button className="primary-action" type="button" disabled={!files.length || files.length > MAX_UPLOAD_FILES || isParsing || isSaving} onClick={() => void parseFiles()}>
            {isParsing ? "Reading courses…" : "Read course list"}
          </button>

          {courses.length ? (
            <div className="course-import-preview">
              <div className="dashboard-section-heading">
                <h4>Review before saving</h4>
                <span>{selectedKeys.size} selected</span>
              </div>
              <ul className="course-import-list">
                {courses.map((course) => {
                  const canSave = Boolean(course.courseId);
                  const isSelected = selectedKeys.has(course.key);
                  return (
                    <li className={!canSave ? "course-import-unmatched" : ""} key={course.key}>
                      <label className="course-import-row">
                        <input
                          type="checkbox"
                          disabled={!canSave}
                          checked={isSelected}
                          onChange={() => setSelectedKeys((current) => {
                            const next = new Set(current);
                            if (next.has(course.key)) next.delete(course.key);
                            else next.add(course.key);
                            return next;
                          })}
                        />
                        <span className="course-import-row-course">
                          <strong>{course.catalogCode ?? course.course_code}</strong>
                          <span>{course.catalogTitle ?? course.course_title ?? "Course title not read"}</span>
                        </span>
                        <span>{course.semester} {course.year}</span>
                        <span>Section {course.section || "not read"}</span>
                        <span>{course.professors.length ? course.professors.join(", ") : "Professor not matched"}</span>
                      </label>
                      {!canSave ? <span className="course-import-match-note">Not matched to the course catalog; this row won’t be saved.</span> : null}
                    </li>
                  );
                })}
              </ul>
              <button className="primary-action" type="button" disabled={isSaving || !selectedKeys.size} onClick={() => void saveCourses()}>
                {isSaving ? "Saving…" : `Save ${selectedKeys.size} selected courses`}
              </button>
            </div>
          ) : null}
          {error ? <p className="message error" role="alert">{error}</p> : null}
          {message ? <p className="message" role="status">{message}</p> : null}
        </div>
      ) : null}

      <dialog
        ref={duplicateDialogRef}
        className="course-import-confirm-dialog"
        aria-labelledby="course-import-confirm-title"
        onCancel={(event) => {
          if (isSaving) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          setDuplicateCourses(null);
        }}
        onClose={() => setDuplicateCourses(null)}
      >
        {duplicateCourses?.length ? (
          <div className="course-import-confirm-content">
            <p className="eyebrow">Review existing courses</p>
            <h3 id="course-import-confirm-title">Some courses are already on your profile</h3>
            <p className="course-import-confirm-intro">
              Did you mean to add another section or term for the same course? Compare the existing and selected sections below. An exact term and section match will update that record instead of creating a duplicate.
            </p>
            <ul className="course-import-duplicate-list">
              {duplicateCourses.map((course) => {
                const hasExactSection = course.incomingSections.some((incoming) =>
                  course.existingSections.some((existing) =>
                    incoming.year === existing.year &&
                    incoming.semester === existing.semester &&
                    incoming.section.trim().toLowerCase() === existing.section.trim().toLowerCase(),
                  ),
                );
                const formatSection = (section: SectionSummary) =>
                  `${section.semester} ${section.year} · Section ${section.section || "not read"} · ${section.professors.length ? section.professors.join(", ") : "Professor not matched"}`;
                return (
                  <li key={course.courseId}>
                    <strong>{course.courseCode} · {course.courseTitle}</strong>
                    <p><b>Already in profile:</b> {course.existingSections.length
                      ? course.existingSections.map(formatSection).join("; ")
                      : "Course exists, but no section details are recorded."}</p>
                    <p><b>Selected:</b> {course.incomingSections.map(formatSection).join("; ")}</p>
                    {hasExactSection ? (
                      <p className="course-import-exact-match">At least one selected term and section already exists. Continuing keeps one record and updates its professor match if needed.</p>
                    ) : (
                      <p className="course-import-additional-section">The selected section will be added under this existing course.</p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="course-import-confirm-actions">
              <button className="secondary-action" type="button" disabled={isSaving} onClick={() => setDuplicateCourses(null)}>
                Cancel
              </button>
              <button className="primary-action" type="button" disabled={isSaving} onClick={() => void saveCourses(true)}>
                {isSaving ? "Saving…" : "Add selected sections"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
