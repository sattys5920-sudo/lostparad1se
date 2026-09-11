-- 영역전 v2 · 1단계 기반
--
-- 여기 있는 것은 판정의 기준이다. 클라이언트의 같은 이름 함수(src/rules/clock.ts)는
-- 화면에 남은 시간을 세기 위한 사본일 뿐이고, 어긋나면 이쪽이 맞다.
--
-- 시간 규칙이 둘이라는 점을 이름으로 갈라 둔다.
--   game_*   게임 시계 — 소등(24:00~08:00)을 건너뛴다
--   실제 시계는 그냥 interval을 더한다 (견제·보강·동맹 제한)

create schema if not exists game;

-- ── 상수 ────────────────────────────────────────────────────────
-- 로직에 숫자를 직접 쓰지 않는다. TypeScript의 src/rules/v2.ts와 짝이다.

create table if not exists game.rule_const (
  key   text primary key,
  value numeric not null,
  note  text
);

insert into game.rule_const (key, value, note) values
  ('day_start_hour',   8,  '등교'),
  ('lights_out_hour',  24, '소등'),
  ('settlement_hour',  21, '방과후 정산'),
  ('last_hours_hour',  15, 'DAY 5 마지막 여섯 시간 시작'),
  ('total_days',       5,  null)
on conflict (key) do update set value = excluded.value, note = excluded.note;

create or replace function game.const(p_key text)
returns numeric language sql stable as $$
  select value from game.rule_const where key = p_key
$$;

-- ── 판 ──────────────────────────────────────────────────────────
-- 인접은 저장하지 않고 좌표에서 계산한다. 손으로 적으면 반드시 틀린다.

create type game.tier as enum ('base', 'zone1', 'gate', 'cross', 'core', 'plaza');
create type game.team_id as enum ('A', 'B', 'C', 'D');

create table if not exists game.tile (
  id       text primary key,
  name     text not null,
  row_idx  int  not null check (row_idx between 0 and 4),
  col_idx  int  not null check (col_idx between 0 and 4),
  value    int  not null,
  tier     game.tier not null,
  home_of  game.team_id,
  slots    int  not null,
  unique (row_idx, col_idx)
);

insert into game.tile (id, name, row_idx, col_idx, value, tier, home_of, slots) values
  ('baseD','D팀 기지',0,0,0,'base','D',0),
  ('storage','창고',0,1,1,'zone1',null,1),
  ('cafeteria','급식실',0,2,4,'gate',null,1),
  ('musicRoom','음악실',0,3,3,'zone1',null,1),
  ('baseC','C팀 기지',0,4,0,'base','C',0),

  ('garden','정원',1,0,3,'zone1',null,1),
  ('mainBuilding','본관',1,1,5,'cross',null,2),
  ('broadcastRoom','방송실',1,2,6,'core',null,2),
  ('newBuilding','신관',1,3,5,'cross',null,2),
  ('clubRoom','동아리실',1,4,1,'zone1',null,1),

  ('rooftop','옥상',2,0,4,'gate',null,1),
  ('studentCouncil','학생회실',2,1,6,'core',null,2),
  ('centralPlaza','중앙광장',2,2,8,'plaza',null,2),
  ('auditorium','강당',2,3,6,'core',null,2),
  ('gym','체육관',2,4,4,'gate',null,1),

  ('hallway','복도',3,0,1,'zone1',null,1),
  ('oldBuilding','구관',3,1,5,'cross',null,2),
  ('playground','운동장',3,2,6,'core',null,2),
  ('annex','별관',3,3,5,'cross',null,2),
  ('scienceRoom','과학실',3,4,3,'zone1',null,1),

  ('baseA','A팀 기지',4,0,0,'base','A',0),
  ('classroom','교실',4,1,3,'zone1',null,1),
  ('library','도서관',4,2,4,'gate',null,1),
  ('artRoom','미술실',4,3,1,'zone1',null,1),
  ('baseB','B팀 기지',4,4,0,'base','B',0)
on conflict (id) do nothing;

/** 가로·세로로 맞닿은 칸. 대각선은 이웃이 아니다. */
create or replace view game.adjacency as
  select a.id as tile_id, b.id as neighbor_id
  from game.tile a
  join game.tile b
    on abs(a.row_idx - b.row_idx) + abs(a.col_idx - b.col_idx) = 1;

create or replace function game.tile_distance(p_a text, p_b text)
returns int language sql stable as $$
  select abs(a.row_idx - b.row_idx) + abs(a.col_idx - b.col_idx)
  from game.tile a, game.tile b
  where a.id = p_a and b.id = p_b
$$;

-- ── 한 판 ───────────────────────────────────────────────────────

create type game.phase as enum ('lobby', 'running', 'finished');

create table if not exists game.game (
  id          uuid primary key default gen_random_uuid(),
  phase       game.phase not null default 'lobby',
  started_at  timestamptz,
  -- 개발용 시계. 기본값이면 실제 시각 그대로다.
  clock_anchor_real timestamptz,
  clock_anchor_game timestamptz,
  clock_speed numeric not null default 1 check (clock_speed between 1 and 120),
  -- 따라잡기가 어디까지 처리했는지
  caught_up_to timestamptz,
  created_at  timestamptz not null default now()
);

-- ── 게임 시계 ───────────────────────────────────────────────────
-- 모든 시각 계산이 반드시 game.now()를 거친다.

/** 지금 몇 시인가. 개발용 시계의 오프셋과 배속을 적용한다. */
create or replace function game.now(p_game uuid)
returns timestamptz language sql stable as $$
  select case
    when g.clock_anchor_real is null then now()
    else g.clock_anchor_game + (now() - g.clock_anchor_real) * g.clock_speed
  end
  from game.game g where g.id = p_game
$$;

/** 게임 속 시각을 실제 시각으로. 타이머를 걸 때 쓴다. */
create or replace function game.real_time_of(p_game uuid, p_game_ts timestamptz)
returns timestamptz language sql stable as $$
  select case
    when g.clock_anchor_real is null then p_game_ts
    else g.clock_anchor_real + (p_game_ts - g.clock_anchor_game) / g.clock_speed
  end
  from game.game g where g.id = p_game
$$;

/** 한국 시간으로 그날 몇 초가 지났는가. */
create or replace function game.seconds_into_day(p_ts timestamptz)
returns int language sql immutable as $$
  select extract(epoch from (p_ts at time zone 'Asia/Seoul')
                          - date_trunc('day', p_ts at time zone 'Asia/Seoul'))::int
$$;

/** 한국 시간으로 그날 h시. */
create or replace function game.time_on(p_ts timestamptz, p_hour numeric)
returns timestamptz language sql immutable as $$
  select ((date_trunc('day', p_ts at time zone 'Asia/Seoul')
           + make_interval(secs => p_hour * 3600)) at time zone 'Asia/Seoul')
$$;

/** 소등 중인가. 24:00~08:00. */
create or replace function game.is_lights_out(p_ts timestamptz)
returns boolean language sql stable as $$
  select game.seconds_into_day(p_ts) < game.const('day_start_hour') * 3600
$$;

/** 그날 그 시각까지 흘러간 활동 시간(초). 소등은 0이다. */
create or replace function game.active_into_day(p_ts timestamptz)
returns int language sql stable as $$
  select greatest(0, least(
    (game.const('lights_out_hour') - game.const('day_start_hour')) * 3600,
    game.seconds_into_day(p_ts) - game.const('day_start_hour') * 3600
  ))::int
$$;

/** 두 시각 사이에 실제로 흐른 게임 시간(초). 소등은 빠진다. */
create or replace function game.active_seconds_between(p_from timestamptz, p_to timestamptz)
returns int language plpgsql stable as $$
declare
  v_per_day int := ((game.const('lights_out_hour') - game.const('day_start_hour')) * 3600)::int;
  v_days int;
begin
  if p_to <= p_from then return 0; end if;
  v_days := (date_trunc('day', p_to at time zone 'Asia/Seoul')::date
           - date_trunc('day', p_from at time zone 'Asia/Seoul')::date);
  if v_days = 0 then
    return game.active_into_day(p_to) - game.active_into_day(p_from);
  end if;
  return (v_per_day - game.active_into_day(p_from))
       + (v_days - 1) * v_per_day
       + game.active_into_day(p_to);
end
$$;

/**
 * 지금부터 활동 시간으로 이만큼 지나면 몇 시인가.
 * 깃발이 언제 끝나는지, 발 묶기가 언제 풀리는지를 이걸로 정한다.
 */
create or replace function game.add_active_seconds(p_from timestamptz, p_seconds int)
returns timestamptz language plpgsql stable as $$
declare
  v_per_day int := ((game.const('lights_out_hour') - game.const('day_start_hour')) * 3600)::int;
  v_cursor timestamptz := p_from;
  v_left int := p_seconds;
  v_today int;
begin
  if p_seconds <= 0 then return p_from; end if;
  -- 소등 중에 시작했으면 등교 시각까지 건너뛴다
  if game.is_lights_out(v_cursor) then
    v_cursor := game.time_on(v_cursor, game.const('day_start_hour'));
  end if;
  loop
    v_today := v_per_day - game.active_into_day(v_cursor);
    if v_left <= v_today then
      return v_cursor + make_interval(secs => v_left);
    end if;
    v_left := v_left - v_today;
    v_cursor := game.time_on(v_cursor + interval '1 day', game.const('day_start_hour'));
  end loop;
end
$$;

/** 게임 며칠째인가. 08:00에 날이 바뀌고, 소등은 전날에 붙는다. */
create or replace function game.day_number(p_started timestamptz, p_now timestamptz)
returns int language plpgsql stable as $$
declare
  v_dawn timestamptz := game.time_on(p_started, game.const('day_start_hour'));
  v_origin timestamptz;
  v_days int;
begin
  v_origin := case when p_started < v_dawn then v_dawn - interval '1 day' else v_dawn end;
  v_days := (date_trunc('day', p_now at time zone 'Asia/Seoul')::date
           - date_trunc('day', v_origin at time zone 'Asia/Seoul')::date);
  if game.is_lights_out(p_now) then v_days := v_days - 1; end if;
  return greatest(1, v_days + 1);
end
$$;

-- ── 이벤트 로그 ─────────────────────────────────────────────────
-- 추가만 한다. 따라잡기의 근거이자 비밀 목표 판정의 근거다.
-- (칸을 뺏긴 적, 남의 칸 깃발 성공 횟수, 동맹을 먼저 깼는지,
--  신뢰표를 준 팀, 비밀을 털어놓았는지 — 전부 여기서 센다.)

create table if not exists game.event (
  id         bigserial primary key,
  game_id    uuid not null references game.game(id) on delete cascade,
  at         timestamptz not null,
  day        int not null,
  kind       text not null,
  team_id    game.team_id,
  player_id  uuid,
  tile_id    text references game.tile(id),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists event_game_at on game.event (game_id, at);
create index if not exists event_game_kind on game.event (game_id, kind);

-- 로그는 고쳐 쓰지 않는다
create or replace rule event_no_update as on update to game.event do instead nothing;
create or replace rule event_no_delete as on delete to game.event do instead nothing;

-- ── 예정 이벤트 ─────────────────────────────────────────────────
-- 상시 켜진 서버를 전제하지 않는다. 요청이 들어오면 밀린 것을 시각 순으로
-- 따라잡는다. 같은 시각이면 ord가 작은 것부터 — 이동 도착(10) →
-- 깃발 판정(20) → 정시 이벤트(30).

create table if not exists game.schedule (
  id        bigserial primary key,
  game_id   uuid not null references game.game(id) on delete cascade,
  due_at    timestamptz not null,
  ord       int not null,
  kind      text not null,
  payload   jsonb not null default '{}'::jsonb,
  done_at   timestamptz
);

create index if not exists schedule_pending on game.schedule (game_id, due_at, ord)
  where done_at is null;

/** 처리 순서. 같은 시각이면 이 값이 작은 것부터. */
create or replace function game.schedule_ord(p_kind text)
returns int language sql immutable as $$
  select case
    when p_kind = 'arrive'    then 10
    when p_kind = 'flag'      then 20
    else 30
  end
$$;

create or replace function game.schedule_add(
  p_game uuid, p_due timestamptz, p_kind text, p_payload jsonb default '{}'::jsonb
) returns bigint language sql as $$
  insert into game.schedule (game_id, due_at, ord, kind, payload)
  values (p_game, p_due, game.schedule_ord(p_kind), p_kind, p_payload)
  returning id
$$;

/** 아직 처리하지 않은, 지금까지 밀린 일들. 따라잡기가 이 순서로 돈다. */
create or replace function game.schedule_due(p_game uuid, p_now timestamptz)
returns setof game.schedule language sql stable as $$
  select * from game.schedule
  where game_id = p_game and done_at is null and due_at <= p_now
  order by due_at, ord, id
$$;
