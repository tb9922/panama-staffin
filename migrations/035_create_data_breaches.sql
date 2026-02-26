CREATE TABLE IF NOT EXISTS data_breaches (
  id                        SERIAL PRIMARY KEY,
  home_id                   INTEGER NOT NULL REFERENCES homes(id),
  title                     VARCHAR(300) NOT NULL,
  description               TEXT,
  discovered_date           DATE NOT NULL,
  data_categories           TEXT[] DEFAULT '{}',
  individuals_affected      INTEGER DEFAULT 0,
  severity                  VARCHAR(20) NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  risk_to_rights            VARCHAR(20) NOT NULL DEFAULT 'unlikely' CHECK (risk_to_rights IN ('unlikely','possible','likely','high')),
  ico_notifiable            BOOLEAN NOT NULL DEFAULT FALSE,
  ico_notification_deadline TIMESTAMPTZ,
  ico_notified              BOOLEAN NOT NULL DEFAULT FALSE,
  ico_notified_date         DATE,
  ico_reference             VARCHAR(100),
  containment_actions       TEXT,
  root_cause                TEXT,
  preventive_measures       TEXT,
  status                    VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','contained','resolved','closed')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_breaches_home ON data_breaches (home_id, status);
