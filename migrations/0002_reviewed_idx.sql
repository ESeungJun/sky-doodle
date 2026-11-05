-- 열어 둔 화면이 새로 승인된 구름을 찾을 때 쓰는 인덱스
CREATE INDEX clouds_status_reviewed ON clouds (status, reviewed_at);
