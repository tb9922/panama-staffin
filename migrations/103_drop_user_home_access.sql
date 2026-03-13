-- Legacy user_home_access table fully superseded by user_home_roles (migration 101).
-- All code paths now use user_home_roles exclusively.
-- Migration 101 already migrated existing rows; this just drops the unused table.
DROP TABLE IF EXISTS user_home_access;
