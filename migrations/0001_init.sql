-- 다른 사람에게 보여 줄 구름(검수 대기·승인·거절·내림)
CREATE TABLE clouds (
  id TEXT PRIMARY KEY,
  seed INTEGER NOT NULL,
  pts TEXT NOT NULL,
  nick TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'hidden')),
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX clouds_status_created ON clouds (status, created_at);
CREATE INDEX clouds_ip_created ON clouds (ip_hash, created_at);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
