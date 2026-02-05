-- Ensure base currencies exist (required for new user registration and investments)
INSERT INTO "Currency" (id, name) VALUES
  ('USD', 'US Dollar'),
  ('UYU', 'Peso Uruguayo')
ON CONFLICT (id) DO NOTHING;
