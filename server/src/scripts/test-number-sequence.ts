/**
 * NumberSequence Runtime 验证脚本（Round 3B-3-4-1B）。
 *
 * 运行：npx tsx src/scripts/test-number-sequence.ts
 *
 * 覆盖：首次生成 / 连续生成 / yyyyMMdd / yyyyMM / 周期切换（日切 + 月切）/
 *      padding（含自然溢出）/ prefix / 15 个 code / rollback /
 *      并发 10 / 50 / 100 / 配置异常路径。
 *
 * 数据库安全：
 *   脚本开始时对 NumberSequence 全表做快照，结束时（含异常）通过 id 全量还原
 *   code / name / prefix / datePattern / padding / currentPeriod / currentValue / version，
 *   因此不会留下测试占号。`updatedAt` 由 Prisma @updatedAt 托管，不参与还原与比对。
 */
import prisma from '../lib/prisma';
import {
  getNextNumber,
  formatNumber,
  resolvePeriod,
  NumberSequenceConfigError,
  SEQ_CODES,
  type SeqCode,
} from '../lib/numberSequence';

// ============ 固定时间点（Asia/Shanghai） ============
const D_0913 = new Date('2026-09-13T03:00:00Z'); // 上海 2026-09-13 11:00
const D_0914 = new Date('2026-09-14T03:00:00Z'); // 上海 2026-09-14 11:00
const D_0915 = new Date('2026-09-15T03:00:00Z'); // 上海 2026-09-15 11:00
const D_1001 = new Date('2026-10-01T03:00:00Z'); // 上海 2026-10-01 11:00

/** 冻结表（仅用于断言；runtime 不硬编码任何格式映射） */
const FROZEN: ReadonlyArray<readonly [SeqCode, string, string]> = [
  ['LEAD', 'XS', '202609'],
  ['OPP', 'BO', '20260914'],
  ['QUO', 'QU', '20260914'],
  ['SMP', 'SM', '20260914'],
  ['SO', 'SO', '20260914'],
  ['PO', 'PO', '20260914'],
  ['PR', 'PR', '20260914'],
  ['SHP', 'SH', '20260914'],
  ['INS', 'QC', '20260914'],
  ['PAY', 'PY', '20260914'],
  ['PRF', 'PF', '20260914'],
  ['CUS', 'CUS', '20260914'],
  ['PRD', 'PRD', '20260914'],
  ['SUP', 'SUP', '20260914'],
  ['CMB', 'CMB', '20260914'],
];

// ============ 断言工具 ============
let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function expectReject(
  name: string,
  fn: () => Promise<unknown>,
  messageIncludes?: string,
): Promise<void> {
  try {
    const value = await fn();
    check(name, false, `未抛出异常，返回 ${JSON.stringify(value)}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const isConfigError = e instanceof NumberSequenceConfigError;
    check(
      name,
      isConfigError && (!messageIncludes || message.includes(messageIncludes)),
      `message=${message}`,
    );
  }
}

// ============ 数据库访问工具 ============
interface SeqSnapshotRow {
  id: string;
  code: string;
  name: string;
  prefix: string;
  datePattern: string;
  padding: number;
  currentPeriod: string;
  currentValue: number;
  version: number;
}

interface SeqState {
  currentPeriod: string;
  currentValue: number;
  version: number;
}

const stateOf = (code: string): Promise<SeqState> =>
  prisma.numberSequence.findUniqueOrThrow({
    where: { code },
    select: { currentPeriod: true, currentValue: true, version: true },
  });

const patchSeq = (
  code: string,
  data: Partial<Omit<SeqSnapshotRow, 'id' | 'name'>>,
): Promise<SeqSnapshotRow> => prisma.numberSequence.update({ where: { code }, data });

/** 单次分配（独立事务，模拟真实 controller 调用形态） */
const alloc = (code: SeqCode, at: Date): Promise<string> =>
  prisma.$transaction((tx) => getNextNumber(tx, code, at));

/** N 路真并发分配（每路独立事务；放宽 maxWait/timeout 以便观察行锁排队） */
const concurrentAlloc = (code: SeqCode, at: Date, n: number): Promise<string[]> =>
  Promise.all(
    Array.from({ length: n }, () =>
      prisma.$transaction((tx) => getNextNumber(tx, code, at), {
        maxWait: 30_000,
        timeout: 30_000,
      }),
    ),
  );

async function main(): Promise<void> {
  const snapshot = await prisma.numberSequence.findMany();
  const before = new Map(snapshot.map((r) => [r.code, r]));

  const restoreAll = async (): Promise<void> => {
    for (const r of snapshot) {
      await prisma.numberSequence.updateMany({
        where: { id: r.id },
        data: {
          code: r.code,
          name: r.name,
          prefix: r.prefix,
          datePattern: r.datePattern,
          padding: r.padding,
          currentPeriod: r.currentPeriod,
          currentValue: r.currentValue,
          version: r.version,
        },
      });
    }
  };

  try {
    // ---------- 0. 纯函数 ----------
    section('0. resolvePeriod / formatNumber（纯函数）');
    check('resolvePeriod yyyyMMdd', resolvePeriod('yyyyMMdd', D_0914) === '20260914');
    check('resolvePeriod yyyyMM', resolvePeriod('yyyyMM', D_0914) === '202609');
    check(
      'resolvePeriod 使用 Asia/Shanghai（UTC 09-13T20:00Z = 上海 09-14）',
      resolvePeriod('yyyyMMdd', new Date('2026-09-13T20:00:00Z')) === '20260914',
    );
    check('formatNumber padding=4', formatNumber('SO', '20260914', 1, 4) === 'SO-20260914-0001');
    check('formatNumber padding=6', formatNumber('SO', '20260914', 1, 6) === 'SO-20260914-000001');
    check(
      'formatNumber 自然溢出（10000 → 5 位，不报错）',
      formatNumber('SO', '20260914', 10000, 4) === 'SO-20260914-10000',
    );
    await expectReject('resolvePeriod 非法 datePattern 抛错', async () =>
      resolvePeriod('yyyyMMddHH', D_0914),
    );
    await expectReject('formatNumber padding=0 抛错', async () => formatNumber('SO', '20260914', 1, 0));
    await expectReject('formatNumber value=0 抛错', async () => formatNumber('SO', '20260914', 0, 4));

    // ---------- 1. 首次生成 + 连续生成 ----------
    section('1. 首次生成 / 连续 3 次');
    await patchSeq('SO', { currentPeriod: '', currentValue: 0 });
    const so1 = await alloc('SO', D_0914);
    check('首次生成 = SO-20260914-0001', so1 === 'SO-20260914-0001', so1);
    const so2 = await alloc('SO', D_0914);
    const so3 = await alloc('SO', D_0914);
    check('连续第 2 次 = 0002', so2 === 'SO-20260914-0002', so2);
    check('连续第 3 次 = 0003', so3 === 'SO-20260914-0003', so3);
    const soState = await stateOf('SO');
    check(
      'state: period=20260914 value=3 version=3',
      soState.currentPeriod === '20260914' && soState.currentValue === 3 && soState.version === 3,
      JSON.stringify(soState),
    );

    // ---------- 2. yyyyMM（LEAD） ----------
    section('2. yyyyMM（LEAD 月度周期）');
    await patchSeq('LEAD', { currentPeriod: '', currentValue: 0 });
    const lead1 = await alloc('LEAD', D_0914);
    check('LEAD = XS-202609-0001', lead1 === 'XS-202609-0001', lead1);
    const leadState = await stateOf('LEAD');
    check('LEAD state: period=202609 value=1', leadState.currentPeriod === '202609' && leadState.currentValue === 1, JSON.stringify(leadState));

    // ---------- 3. 周期切换 ----------
    section('3. 周期切换（日切 + 同周期递增）');
    await patchSeq('SO', { currentPeriod: '20260913', currentValue: 15 });
    const soAfterDay = await alloc('SO', D_0914);
    const soResetState = await stateOf('SO');
    check('日切 20260913 → 20260914 归零 = 0001', soAfterDay === 'SO-20260914-0001', soAfterDay);
    check(
      '日切后 state: period=20260914 value=1',
      soResetState.currentPeriod === '20260914' && soResetState.currentValue === 1,
      JSON.stringify(soResetState),
    );
    await patchSeq('SO', { currentPeriod: '20260914', currentValue: 7 });
    const soSamePeriod = await alloc('SO', D_0914);
    check('同周期递增 7 → 0008', soSamePeriod === 'SO-20260914-0008', soSamePeriod);
    await patchSeq('LEAD', { currentPeriod: '202609', currentValue: 99 });
    const leadMonthFlip = await alloc('LEAD', D_1001);
    check('月切 202609 → 202610 归零 = XS-202610-0001', leadMonthFlip === 'XS-202610-0001', leadMonthFlip);
    const leadFlipState = await stateOf('LEAD');
    check('月切后 state: period=202610 value=1', leadFlipState.currentPeriod === '202610' && leadFlipState.currentValue === 1, JSON.stringify(leadFlipState));

    // ---------- 4. padding ----------
    section('4. padding（含自然溢出）');
    await patchSeq('SO', { padding: 6, currentPeriod: '', currentValue: 0 });
    const padded = await alloc('SO', D_0915);
    check('padding=6 → SO-20260915-000001', padded === 'SO-20260915-000001', padded);
    await patchSeq('SO', { padding: 4, currentPeriod: '20260914', currentValue: 9999 });
    const overflow = await alloc('SO', D_0914);
    check('value=9999 → 10000（自然溢出 5 位，不报错）', overflow === 'SO-20260914-10000', overflow);

    // ---------- 5. prefix / 15 个 code ----------
    section('5. 15 个 code × prefix');
    for (const [code, prefix, period] of FROZEN) {
      await patchSeq(code, { currentPeriod: '', currentValue: 0 });
      const no = await alloc(code, D_0914);
      check(`${code} → ${prefix}-${period}-0001`, no === `${prefix}-${period}-0001`, no);
    }
    check('冻结表覆盖 15 个 code', FROZEN.length === SEQ_CODES.length && FROZEN.every(([c]) => SEQ_CODES.includes(c)));

    // ---------- 6. rollback ----------
    section('6. transaction rollback（不产生编号空洞）');
    await patchSeq('SO', { currentPeriod: '', currentValue: 0 });
    const rollbackThrew = await prisma
      .$transaction(async (tx) => {
        await getNextNumber(tx, 'SO', D_0914);
        throw new Error('ROLLBACK_TEST');
      })
      .then(() => false)
      .catch(() => true);
    check('事务内取号后抛错 → 事务已回滚', rollbackThrew);
    const afterRollback = await stateOf('SO');
    check(
      '回滚后 state 恢复 period="" value=0',
      afterRollback.currentPeriod === '' && afterRollback.currentValue === 0,
      JSON.stringify(afterRollback),
    );
    const soAfterRollback = await alloc('SO', D_0914);
    check('回滚后再次取号仍为 0001（无空洞）', soAfterRollback === 'SO-20260914-0001', soAfterRollback);

    // ---------- 7. 并发 ----------
    section('7. 真并发（10 / 50 / 100）');
    const batches: ReadonlyArray<readonly [number, Date, string]> = [
      [10, D_0913, '20260913'],
      [50, D_0915, '20260915'],
      [100, D_1001, '20261001'],
    ];
    for (const [n, at, period] of batches) {
      await patchSeq('SO', { currentPeriod: '', currentValue: 0 });
      const started = Date.now();
      const nos = await concurrentAlloc('SO', at, n);
      const sorted = [...nos].sort();
      const unique = new Set(nos).size;
      check(`并发 ${n}：结果全部唯一（unique=${unique}/${n}）`, unique === n, `unique=${unique}`);
      check(
        `并发 ${n}：编号连续 ${period}-0001 … ${period}-${String(n).padStart(4, '0')}`,
        sorted[0] === `SO-${period}-0001` &&
          sorted[n - 1] === `SO-${period}-${String(n).padStart(4, '0')}`,
        `${sorted[0]} .. ${sorted[n - 1]}`,
      );
      const st = await stateOf('SO');
      check(
        `并发 ${n}：currentValue 精确 +${n}（=${n}）`,
        st.currentValue === n && st.currentPeriod === period,
        JSON.stringify(st),
      );
      console.log(`    （${n} 并发耗时 ${Date.now() - started}ms）`);
    }

    // ---------- 8. 配置异常路径 ----------
    section('8. 配置异常路径（不自愈 / 不 fallback）');
    await expectReject(
      "非法 code → 抛错 'Unknown NumberSequence code'",
      () => prisma.$transaction((tx) => getNextNumber(tx, 'NOPE' as SeqCode, D_0914)),
      'Unknown NumberSequence code',
    );
    await patchSeq('PRF', { padding: 0, currentPeriod: '', currentValue: 0 });
    await expectReject(
      "padding=0 → 抛错 'Invalid NumberSequence padding'",
      () => alloc('PRF', D_0914),
      'Invalid NumberSequence padding',
    );
    const prfUntouched = await stateOf('PRF');
    check(
      '非法 padding 在写库前失败（计数未被消耗）',
      prfUntouched.currentValue === 0 && prfUntouched.currentPeriod === '',
      JSON.stringify(prfUntouched),
    );
    await patchSeq('PRF', { padding: 4 });
    await patchSeq('LEAD', { datePattern: 'yyyyMMddHH' });
    await expectReject(
      "非法 datePattern → 抛错 'Unsupported NumberSequence datePattern'",
      () => alloc('LEAD', D_0914),
      'Unsupported NumberSequence datePattern',
    );
    await patchSeq('LEAD', { datePattern: 'yyyyMM' });
    // 序列行缺失：临时改 code 模拟行不存在（快照还原时按 id 恢复）
    await patchSeq('CMB', { code: 'ZZZ_TMP' });
    await expectReject(
      "序列行缺失 → 抛错 'configuration not found'",
      () => alloc('CMB', D_0914),
      'NumberSequence configuration not found: CMB',
    );
    await patchSeq('ZZZ_TMP', { code: 'CMB' });
    const cmbBack = await prisma.numberSequence.findUnique({ where: { code: 'CMB' } });
    check('序列行已恢复（CMB 存在）', cmbBack !== null);
  } finally {
    await restoreAll();
  }

  // ---------- 9. 最终状态还原校验 ----------
  section('9. 最终状态（必须与测试前一致，无占号）');
  const after = await prisma.numberSequence.findMany({ orderBy: { code: 'asc' } });
  let mismatched = 0;
  for (const row of after) {
    const prev = before.get(row.code);
    const same =
      prev !== undefined &&
      prev.currentPeriod === row.currentPeriod &&
      prev.currentValue === row.currentValue &&
      prev.version === row.version &&
      prev.prefix === row.prefix &&
      prev.datePattern === row.datePattern &&
      prev.padding === row.padding;
    if (!same) {
      mismatched += 1;
      console.log(
        `  ! ${row.code}: before=${JSON.stringify(prev && { p: prev.currentPeriod, v: prev.currentValue, ver: prev.version })} after=${JSON.stringify({ p: row.currentPeriod, v: row.currentValue, ver: row.version })}`,
      );
    }
    console.log(
      `  ${row.code.padEnd(4)} ${row.prefix.padEnd(4)} ${row.datePattern.padEnd(9)} pad=${row.padding} period=${JSON.stringify(row.currentPeriod)} value=${row.currentValue} version=${row.version}`,
    );
  }
  check('15 行全部还原（period / value / version / 配置）', after.length === 15 && mismatched === 0, `mismatched=${mismatched}`);

  console.log(`\n================ 结果 ================`);
  console.log(`PASS: ${passed}   FAIL: ${failures.length}`);
  if (failures.length > 0) {
    console.log('失败项：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('ALL PASS');
  }
}

main()
  .catch((e) => {
    console.error('测试脚本异常：', e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
