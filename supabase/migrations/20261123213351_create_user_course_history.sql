CREATE TABLE public.user_course_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses (id) ON DELETE CASCADE,
  offering_id uuid REFERENCES public.course_offerings (id) ON DELETE SET NULL,
  term_year integer NOT NULL CHECK (term_year >= 1900 AND term_year <= 2200),
  term_semester text NOT NULL CHECK (term_semester IN ('Spring', 'Summer', 'Fall')),
  section text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_course_history_pkey PRIMARY KEY (id),
  CONSTRAINT user_course_history_term_course_section_key
    UNIQUE (user_id, course_id, term_year, term_semester, section)
);

CREATE INDEX user_course_history_user_term_idx
  ON public.user_course_history (user_id, term_year DESC, term_semester);

ALTER TABLE public.user_course_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own course history"
  ON public.user_course_history FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can add their own course history"
  ON public.user_course_history FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update their own course history"
  ON public.user_course_history FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete their own course history"
  ON public.user_course_history FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_course_history TO authenticated;
