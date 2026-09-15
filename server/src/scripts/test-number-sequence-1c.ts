/**
 * NumberSequence Runtime 验证脚本 · 1C 增量（Round 3B-3-4-1C）。
 *
 * 运行：npx tsx src/scripts/test-number-sequence-1c.ts
 *
 * 覆盖（1C 新增域）：
 *   1. PRD / CUS 真并发 10 / 50 / 100（唯一 + 连续 + 计数精确）
 *   2. CMB + PRD 组合事务回滚（ComboProduct + 内部 Product 全部回滚，编号不消耗）
 *
 * 数据库安全：开始对 NumberSequence 全表快照，结束（含异常）按 id 全量还原，
 * 因此不会留下测试占号。`updatedAt` 由 Prisma @updatedAt 托管，不参与还原与断言。
 */
import prisma from '../lib/prisma';
import { getNextNumber, type SeqCode } from '../lib/numberSequence';

const D_0913 = new Date('2026-09-13T03:00:00Z'); // 上海 2026-09-13
const D_0915 = new Date('2026-09-15T03:00:00Z'); // 上海 2026-09-15
const D_1001 = new Date('2026-10-01T03:00:00Z'); // 上海 2026-10-01

const ROLLBACK_PRODUCT_NAME = 'ROLLBACK-TEST-PRODUCT';
const ROLLBACK_COMBO_NAME = 'ROLLBACK-TEST-COMBO';

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

const section = (title: string): void => console.log(`\n=== ${title} ===`);

const stateOf = (code: string): Promise<{ currentPeriod: string; currentValue: number; version: number }> =>
  prisma.numberSequence.findUniqueOrThrow({
    where: { code },
    select: { currentPeriod: true, currentValue: true, version: true },
  });

const resetSeq = (code: string): Promise<unknown> =>
  prisma.numberSequence.update({
    where: { code },
    data: { currentPeriod: '', currentValue: 0 },
  });

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
    // ---------- 1. 新序列真并发 ----------
    section('1. 新序列真并发（PRD / CUS）');
    const cases: ReadonlyArray<readonly [SeqCode, string, number, Date, string]> = [
      ['PRD', 'PRD', 10, D_0913, '20260913'],
      ['PRD', 'PRD', 50, D_0915, '20260915'],
      ['PRD', 'PRD', 100, D_1001, '20261001'],
      ['CUS', 'CUS', 10, D_0913, '20260913'],
      ['CUS', 'CUS', 50, D_0915, '20260915'],
      ['CUS', 'CUS', 100, D_1001, '20261001'],
    ];

    for (const [code, prefix, n, at, period] of cases) {
      await resetSeq(code);
      const started = Date.now();
      const nos = await concurrentAlloc(code, at, n);
      const sorted = [...nos].sort();
      const unique = new Set(nos).size;
      const last = String(n).padStart(4, '0');
      check(`${code} 并发 ${n}：全部唯一（unique=${unique}/${n}）`, unique === n, `unique=${unique}`);
      check(
        `${code} 并发 ${n}：连续 ${prefix}-${period}-0001 … ${prefix}-${period}-${last}`,
        sorted[0] === `${prefix}-${period}-0001` && sorted[n - 1] === `${prefix}-${period}-${last}`,
        `${sorted[0]} .. ${sorted[n - 1]}`,
      );
      const st = await stateOf(code);
      check(
        `${code} 并发 ${n}：currentValue 精确 = ${n}`,
        st.currentValue === n && st.currentPeriod === period,
        JSON.stringify(st),
      );
      console.log(`    （${code} × ${n} 耗时 ${Date.now() - started}ms）`);
    }

    // ---------- 2. CMB + PRD 组合事务回滚 ----------
    section('2. CMB + PRD 组合事务回滚（不含孤儿、不消耗编号）');
    await resetSeq('CMB');
    await resetSeq('PRD');

    const combosBefore = await prisma.comboProduct.count();
    const productsBefore = await prisma.product.count();

    let createdProductId: string | null = null;
    let createdComboId: string | null = null;
    let rolledBack = false;

    try {
      await prisma.$transaction(async (tx) => {
        const comboNo = await getNextNumber(tx, 'CMB');
        const productNo = await getNextNumber(tx, 'PRD');

        const product = await tx.product.create({
          data: { productNo, name: ROLLBACK_PRODUCT_NAME },
        });
        createdProductId = product.id;

        const combo = await tx.comboProduct.create({
          data: {
            comboNo,
            name: ROLLBACK_COMBO_NAME,
            items: { create: [{ productId: product.id, quantity: 1, sort: 0 }] },
          },
        });
        createdComboId = combo.id;

        throw new Error('CMB_ROLLBACK_TEST');
      });
    } catch {
      rolledBack = true;
    }

    check('事务内抛错 → 已回滚', rolledBack);

    const orphanProduct = createdProductId
      ? await prisma.product.findUnique({ where: { id: createdProductId } })
      : null;
    const orphanCombo = createdComboId
      ? await prisma.comboProduct.findUnique({ where: { id: createdComboId } })
      : null;
    check('无孤儿 Product（内部创建已回滚）', orphanProduct === null, String(orphanProduct?.id));
    check('无 ComboProduct 残留', orphanCombo === null, String(orphanCombo?.id));
    check(
      '表行数与回滚前一致',
      (await prisma.comboProduct.count()) === combosBefore &&
        (await prisma.product.count()) === productsBefore,
    );

    const cmbState = await stateOf('CMB');
    const prdState = await stateOf('PRD');
    check(
      'CMB 计数未增加（period="" value=0）',
      cmbState.currentPeriod === '' && cmbState.currentValue === 0,
      JSON.stringify(cmbState),
    );
    check(
      'PRD 计数未增加（period="" value=0）',
      prdState.currentPeriod === '' && prdState.currentValue === 0,
      JSON.stringify(prdState),
    );

    // 回滚后重新取号 → 仍为 0001（无空洞）
    const comboNoAfter = await prisma.$transaction((tx) => getNextNumber(tx, 'CMB', D_0915));
    const productNoAfter = await prisma.$transaction((tx) => getNextNumber(tx, 'PRD', D_0915));
    check('回滚后 CMB 仍为 0001', comboNoAfter === 'CMB-20260915-0001', comboNoAfter);
    check('回滚后 PRD 仍为 0001', productNoAfter === 'PRD-20260915-0001', productNoAfter);
  } finally {
    await restoreAll();
  }

  // ---------- 3. 最终状态还原校验 ----------
  section('3. 最终状态（必须与测试前一致，无占号）');
  const after = await prisma.numberSequence.findMany({ orderBy: { code: 'asc' } });
  const beforeByCode = new Map(snapshot.map((r) => [r.code, r]));
  let mismatched = 0;
  for (const row of after) {
    const prev = beforeByCode.get(row.code);
    const same =
      prev !== undefined &&
      prev.currentPeriod === row.currentPeriod &&
      prev.currentValue === row.currentValue &&
      prev.version === row.version;
    if (!same) {
      mismatched += 1;
      console.log(`  ! ${row.code} 未还原: ${JSON.stringify({ p: row.currentPeriod, v: row.currentValue, ver: row.version })}`);
    }
  }
  check(
    '15 行 period / value / version 全部还原',
    after.length === 15 && mismatched === 0,
    `mismatched=${mismatched}`,
  );

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
