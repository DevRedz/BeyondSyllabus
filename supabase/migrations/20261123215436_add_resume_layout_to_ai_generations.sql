ALTER TABLE public.ai_generations
  ADD COLUMN resume_section text,
  ADD COLUMN resume_position integer,
  ADD CONSTRAINT ai_generations_resume_section_check
    CHECK (resume_section IS NULL OR resume_section IN ('skills', 'projects')),
  ADD CONSTRAINT ai_generations_resume_position_check
    CHECK (resume_position IS NULL OR resume_position >= 0),
  ADD CONSTRAINT ai_generations_resume_layout_pair_check
    CHECK ((resume_section IS NULL) = (resume_position IS NULL));

CREATE INDEX ai_generations_user_resume_layout_idx
  ON public.ai_generations (user_id, resume_section, resume_position)
  WHERE resume_section IS NOT NULL;
