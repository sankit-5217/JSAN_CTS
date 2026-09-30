-- Business requirement: the vendor this platform is built for isn't known
-- yet, so the schema shouldn't name one. RENAME VALUE (not DROP+ADD, which
-- is what a plain Prisma schema diff would generate) so every existing row
-- already set to the old role value is updated in place, in one statement,
-- with no data migration script needed.
ALTER TYPE "UserRole" RENAME VALUE 'CTS_MANAGER_VIEWER' TO 'CLIENT_MANAGER_VIEWER';
