ALTER TABLE public.user_courses
  ADD CONSTRAINT user_courses_user_id_course_id_key
  UNIQUE (user_id, course_id);

NOTIFY pgrst, 'reload schema';
