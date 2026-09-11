-- 서버 쪽 게임 시계와 판이 맞는지 본다.
--
-- TypeScript 사본(src/rules/clock.test.ts)과 같은 값을 쓴다. 둘이 어긋나면
-- 화면에 뜨는 남은 시간과 실제 판정이 달라져 사람이 속는다.
--
-- 실패하면 assert가 예외를 던지고 psql이 멈춘다(ON_ERROR_STOP).

\set ON_ERROR_STOP on
set client_min_messages to notice;

create or replace function pg_temp.check(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL  %: % (기대 %)', p_label, p_got, p_want;
  end if;
  raise notice 'PASS  %: %', p_label, p_got;
end
$$;

-- 서울 시각을 만드는 지름길
create or replace function pg_temp.s(p text)
returns timestamptz language sql immutable as $$
  select (p || '+09')::timestamptz
$$;

do $$
declare
  per_day int := 16 * 3600;
begin
  -- ── 서울 시각 읽기 ──
  perform pg_temp.check('그날 0초',      game.seconds_into_day(pg_temp.s('2026-03-02 00:00:00')), 0);
  perform pg_temp.check('그날 08:00',    game.seconds_into_day(pg_temp.s('2026-03-02 08:00:00')), 8*3600);
  perform pg_temp.check('그날 23:59:59', game.seconds_into_day(pg_temp.s('2026-03-02 23:59:59')), 24*3600-1);
  perform pg_temp.check('08시 짚기', game.time_on(pg_temp.s('2026-03-02 13:37:00'), 8), pg_temp.s('2026-03-02 08:00:00'));
  perform pg_temp.check('21시 짚기', game.time_on(pg_temp.s('2026-03-02 13:37:00'), 21), pg_temp.s('2026-03-02 21:00:00'));

  -- ── 소등 ──
  perform pg_temp.check('00:30 소등',    game.is_lights_out(pg_temp.s('2026-03-02 00:30:00')), true);
  perform pg_temp.check('07:59:59 소등', game.is_lights_out(pg_temp.s('2026-03-02 07:59:59')), true);
  perform pg_temp.check('08:00 등교',    game.is_lights_out(pg_temp.s('2026-03-02 08:00:00')), false);
  perform pg_temp.check('23:59:59 수업', game.is_lights_out(pg_temp.s('2026-03-02 23:59:59')), false);

  -- ── 흐른 시간 세기 ──
  perform pg_temp.check('낮 2시간 반',
    game.active_seconds_between(pg_temp.s('2026-03-02 10:00:00'), pg_temp.s('2026-03-02 12:30:00')),
    (2.5*3600)::int);
  perform pg_temp.check('소등 중엔 0',
    game.active_seconds_between(pg_temp.s('2026-03-02 01:00:00'), pg_temp.s('2026-03-02 05:00:00')), 0);
  perform pg_temp.check('밤을 넘으면 소등만큼 빠진다',
    game.active_seconds_between(pg_temp.s('2026-03-02 23:30:00'), pg_temp.s('2026-03-03 08:30:00')), 3600);
  perform pg_temp.check('사흘치',
    game.active_seconds_between(pg_temp.s('2026-03-02 08:00:00'), pg_temp.s('2026-03-05 08:00:00')), 3*per_day);
  perform pg_temp.check('거꾸로면 0',
    game.active_seconds_between(pg_temp.s('2026-03-02 12:00:00'), pg_temp.s('2026-03-02 11:00:00')), 0);

  -- ── 활동 시간 더하기 ──
  perform pg_temp.check('낮 30분',
    game.add_active_seconds(pg_temp.s('2026-03-02 10:00:00'), 30*60), pg_temp.s('2026-03-02 10:30:00'));
  perform pg_temp.check('23:30 + 60분 = 다음 날 08:30',
    game.add_active_seconds(pg_temp.s('2026-03-02 23:30:00'), 60*60), pg_temp.s('2026-03-03 08:30:00'));
  perform pg_temp.check('소등 중 시작은 등교부터',
    game.add_active_seconds(pg_temp.s('2026-03-02 03:00:00'), 30*60), pg_temp.s('2026-03-02 08:30:00'));
  perform pg_temp.check('여러 밤 넘기기',
    game.add_active_seconds(pg_temp.s('2026-03-02 20:00:00'), 24*3600), pg_temp.s('2026-03-04 12:00:00'));
  perform pg_temp.check('0은 제자리',
    game.add_active_seconds(pg_temp.s('2026-03-02 10:00:00'), 0), pg_temp.s('2026-03-02 10:00:00'));

  -- 더한 만큼 다시 세면 그대로여야 한다
  declare
    v_start timestamptz;
    v_end timestamptz;
    v_min int;
  begin
    foreach v_start in array array[
      pg_temp.s('2026-03-02 08:00:00'),
      pg_temp.s('2026-03-02 19:12:34'),
      pg_temp.s('2026-03-02 23:59:00')
    ] loop
      foreach v_min in array array[30, 60, 120, 180, 500] loop
        v_end := game.add_active_seconds(v_start, v_min*60);
        perform pg_temp.check(
          format('%s +%s분 왕복', v_start::time, v_min),
          game.active_seconds_between(v_start, v_end), v_min*60);
      end loop;
    end loop;
  end;

  -- ── 며칠째인가 ──
  perform pg_temp.check('첫날 08:00 = DAY 1',
    game.day_number(pg_temp.s('2026-03-02 08:00:00'), pg_temp.s('2026-03-02 08:00:00')), 1);
  perform pg_temp.check('첫날 23:59 = DAY 1',
    game.day_number(pg_temp.s('2026-03-02 08:00:00'), pg_temp.s('2026-03-02 23:59:00')), 1);
  perform pg_temp.check('소등은 전날에 붙는다',
    game.day_number(pg_temp.s('2026-03-02 08:00:00'), pg_temp.s('2026-03-03 03:00:00')), 1);
  perform pg_temp.check('08:00에 날이 바뀐다',
    game.day_number(pg_temp.s('2026-03-02 08:00:00'), pg_temp.s('2026-03-03 08:00:00')), 2);
  perform pg_temp.check('닷새째',
    game.day_number(pg_temp.s('2026-03-02 08:00:00'), pg_temp.s('2026-03-06 08:00:00')), 5);

  -- ── 판 ──
  perform pg_temp.check('스물다섯 칸', (select count(*)::int from game.tile), 25);
  perform pg_temp.check('기지 넷',   (select count(*)::int from game.tile where tier = 'base'), 4);
  perform pg_temp.check('1구역 여덟', (select count(*)::int from game.tile where tier = 'zone1'), 8);
  perform pg_temp.check('관문 넷',   (select count(*)::int from game.tile where tier = 'gate'), 4);
  perform pg_temp.check('교차로 넷', (select count(*)::int from game.tile where tier = 'cross'), 4);
  perform pg_temp.check('핵심 넷',   (select count(*)::int from game.tile where tier = 'core'), 4);
  perform pg_temp.check('중앙 하나', (select count(*)::int from game.tile where tier = 'plaza'), 1);

  perform pg_temp.check('인접은 서로에게 성립',
    (select count(*)::int from game.adjacency a
      where not exists (select 1 from game.adjacency b
                        where b.tile_id = a.neighbor_id and b.neighbor_id = a.tile_id)), 0);

  perform pg_temp.check('기지는 이웃이 둘',
    (select count(*)::int from game.tile t
      where t.tier = 'base'
        and (select count(*) from game.adjacency a where a.tile_id = t.id) <> 2), 0);

  perform pg_temp.check('기지에서 중앙까지 네 걸음',
    (select count(*)::int from game.tile t
      where t.tier = 'base' and game.tile_distance(t.id, 'centralPlaza') <> 4), 0);

  perform pg_temp.check('1구역 합이 팀마다 4',
    (select count(*)::int from game.tile b
      where b.tier = 'base'
        and (select sum(n.value) from game.adjacency a join game.tile n on n.id = a.neighbor_id
             where a.tile_id = b.id) <> 4), 0);

  perform pg_temp.check('중앙광장은 핵심 넷에만 붙는다',
    (select count(*)::int from game.adjacency a join game.tile n on n.id = a.neighbor_id
      where a.tile_id = 'centralPlaza' and n.tier <> 'core'), 0);

  perform pg_temp.check('대각선은 이웃이 아니다',
    (select count(*)::int from game.adjacency
      where tile_id = 'oldBuilding' and neighbor_id = 'centralPlaza'), 0);

  -- ── 처리 순서 ──
  perform pg_temp.check('이동 도착이 먼저', game.schedule_ord('arrive'), 10);
  perform pg_temp.check('그다음 깃발',      game.schedule_ord('flag'), 20);
  perform pg_temp.check('정시가 마지막',    game.schedule_ord('settlement'), 30);

  raise notice '── 전부 통과 ──';
end
$$;

-- ── 개발용 시계 ── (판 하나를 만들어 본다)
do $$
declare
  v_game uuid;
  v_anchor timestamptz := pg_temp.s('2026-03-02 08:00:00');
begin
  insert into game.game (clock_anchor_real, clock_anchor_game, clock_speed)
  values (now() - interval '10 seconds', v_anchor, 60)
  returning id into v_game;

  -- 실제 10초 = 게임 10분
  perform pg_temp.check('배속 60이면 10초가 10분',
    (select extract(epoch from (game.now(v_game) - v_anchor))::int / 60), 10);

  -- 되돌리면 제자리
  perform pg_temp.check('되돌리면 제자리',
    (select abs(extract(epoch from (game.real_time_of(v_game, game.now(v_game)) - now())))::int), 0);

  -- 시계를 안 걸면 실제 시각
  insert into game.game default values returning id into v_game;
  perform pg_temp.check('시계를 안 걸면 실제 시각',
    (select abs(extract(epoch from (game.now(v_game) - now())))::int), 0);

  raise notice '── 개발용 시계 통과 ──';
end
$$;
