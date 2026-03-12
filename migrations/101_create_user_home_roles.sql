-- Per-home role-based access control
-- Replaces binary user_home_access with role-per-home assignments.
-- Existing admins become home_manager, existing viewers become viewer.

CREATE TABLE IF NOT EXISTS user_home_roles (
  id          SERIAL       PRIMARY KEY,
  username    VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
  home_id     INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  role_id     VARCHAR(30)  NOT NULL,
  staff_id    VARCHAR(20),
  granted_by  VARCHAR(100),
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(username, home_id)
);

CREATE INDEX IF NOT EXISTS idx_uhr_username ON user_home_roles(username);
CREATE INDEX IF NOT EXISTS idx_uhr_home_id  ON user_home_roles(home_id);

-- Migrate existing access: admin users → home_manager, viewer users → viewer
INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
  SELECT uha.username, uha.home_id,
    CASE WHEN u.role = 'admin' THEN 'home_manager' ELSE 'viewer' END,
    'migration_101'
  FROM user_home_access uha
  JOIN users u ON u.username = uha.username
  WHERE u.active = true
  ON CONFLICT (username, home_id) DO NOTHING;
