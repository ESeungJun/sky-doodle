-- 무작위 뽑기를 전체 읽기(ORDER BY RANDOM()) 대신 색인으로 한다
ALTER TABLE clouds ADD COLUMN rnd INTEGER NOT NULL DEFAULT 0;
UPDATE clouds SET rnd = abs(random()) % 2147483647;
CREATE INDEX clouds_status_rnd ON clouds (status, rnd);

-- 누가 확인했는지(Access 메일, 자동 정리는 'auto')
ALTER TABLE clouds ADD COLUMN reviewed_by TEXT;

-- 이틀 지난 접속 해시를 지울 때 해시가 남은 행만 훑는다
CREATE INDEX clouds_hashed ON clouds (created_at) WHERE ip_hash != '';
