#!/usr/bin/env bash
# 서버 쪽(SQL) 시험. 임시 Postgres를 띄워 마이그레이션을 얹고 시험을 돌린다.
#
# 이미 쓸 수 있는 Postgres가 있으면 PGHOST/PGPORT/PGUSER를 맞춰 두고
# SKIP_SETUP=1 로 실행한다.
set -euo pipefail
cd "$(dirname "$0")/.."

PGDATA=${PGDATA:-/tmp/pg-lostparad1se}
export PGHOST=${PGHOST:-/tmp}
export PGPORT=${PGPORT:-55432}
export PGUSER=${PGUSER:-postgres}
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
# Postgres는 root로 못 돈다. root라면 postgres 계정으로 떨어뜨린다.
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  AS_PG="su postgres -c"
  export PGUSER=postgres
else
  AS_PG="bash -c"
fi
run_pg() { $AS_PG "$1"; }

cleanup() {
  if [ -z "${SKIP_SETUP:-}" ]; then run_pg "$BIN/pg_ctl -D $PGDATA stop -s -m fast" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

if [ -z "${SKIP_SETUP:-}" ]; then
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA" && chown -R postgres "$PGDATA" 2>/dev/null || true
  run_pg "$BIN/initdb -D $PGDATA -A trust -U $PGUSER >/dev/null"
  run_pg "$BIN/pg_ctl -D $PGDATA -o '-k $PGHOST -p $PGPORT -c listen_addresses=' -l /tmp/pg-lostparad1se.log start -s"
  until psql -d postgres -c 'select 1' >/dev/null 2>&1; do sleep 1; done
fi

for f in supabase/migrations/*.sql; do
  echo "▸ $f"
  psql -d postgres -v ON_ERROR_STOP=1 -q -f "$f"
done

fails=0
for f in supabase/tests/*.test.sql; do
  echo "▸ $f"
  if out=$(psql -d postgres -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    echo "  통과 $(grep -c 'PASS' <<<"$out")건"
  else
    echo "$out" | grep -E 'FAIL|ERROR' || true
    fails=$((fails + 1))
  fi
done

[ "$fails" -eq 0 ] && echo "SQL 시험 전부 통과" || { echo "실패한 파일 $fails개"; exit 1; }
