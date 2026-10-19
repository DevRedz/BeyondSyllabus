INSERT INTO storage.buckets (id, name, public)
VALUES ('syllabi', 'syllabi', false)
ON CONFLICT (id) DO NOTHING;
