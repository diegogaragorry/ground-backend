-- Set diego.garagorry@gmail.com as SUPER_ADMIN
UPDATE "User"
SET role = 'SUPER_ADMIN'::"UserRole"
WHERE email = 'diego.garagorry@gmail.com';
