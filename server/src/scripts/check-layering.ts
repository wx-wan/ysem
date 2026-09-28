/**
 * 分层依赖检查器（Round R-1 Foundation）
 *
 * 运行：
 *   npx tsx src/scripts/check-layering.ts            # 报告模式（默认；始终退出 0）
 *   npx tsx src/scripts/check-layering.ts --strict   # 严格模式（存在违规时退出 1）
 *
 * 目标：
 *   1. 固化依赖方向：Controller → Business → Operation → Data → Prisma；
 *   2. **先记录迁移点** —— 把当前违反分层的既有代码量化成可跟踪清单，
 *      而不是本轮强行全部重写；
 *   3. 为后续「试点 → 验证 → 批量迁移」提供进度指标（下方 METRICS）。
 *
 * 本脚本只读取源码文本，不修改任何文件，不连接数据库。
 */

import fs from 'fs';
import path from 'path';

// ============================================================
// 层定义
// ============================================================

/** 参与依赖方向判定的业务层（数字越大越靠下游；import 只能「向下或同级」） */
type RankedLayer = 'controllers' | 'services' | 'operations' | 'repositories';

/** 非业务层：不参与方向判定，但受「不得依赖业务层」约束 */
type SharedLayer = 'lib' | 'utils' | 'middleware';

type Layer = RankedLayer | SharedLayer | 'state' | 'routes' | 'composition' | 'unknown';

const RANK: Record<RankedLayer, number> = {
  controllers: 1,
  services: 2,
  operations: 3,
  repositories: 4,
};

const SHARED_LAYERS: SharedLayer[] = ['lib', 'utils', 'middleware'];

/** 禁止出现在 Business / Operation / Data 层的 HTTP 依赖 */
const HTTP_PACKAGES = ['express', 'express-rate-limit'];
const HTTP_PACKAGE_PREFIXES = ['express-'];

const SRC_ROOT = path.resolve(__dirname, '..');

// ============================================================
// 工具
// ============================================================

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function relativeToSrc(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/');
}

function layerOfTopSegment(segment: string): Layer {
  if (segment === 'lib' || segment === 'utils' || segment === 'middleware') return segment;
  if (segment === 'controllers' || segment === 'services' || segment === 'operations' || segment === 'repositories') {
    return segment;
  }
  if (segment === 'state') return 'state';
  if (segment === 'routes') return 'routes';
  if (segment === 'scripts') return 'composition';
  return 'unknown';
}

function layerOfFile(file: string): Layer {
  const rel = relativeToSrc(file);
  const segments = rel.split('/');
  // src 根目录下的 app.ts / index.ts / swagger.ts = 组装根
  if (segments.length === 1) return 'composition';
  return layerOfTopSegment(segments[0]);
}

/** 把相对 import 说明符解析为真实文件（支持省略 .ts 与目录 index.ts） */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(path.dirname(fromFile), spec);
  const candidates = [abs, `${abs}.ts`, path.join(abs, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return `${abs}.ts`;
}

/** 去除块注释与行注释，避免注释中的示例 import 被误判 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

interface RawImport {
  spec: string;
  typeOnly: boolean;
}

function extractImports(source: string): RawImport[] {
  const code = stripComments(source);
  const out: RawImport[] = [];

  // import [type] ... from 'x'
  const fromRe = /import\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(fromRe)) {
    out.push({ spec: m[2], typeOnly: Boolean(m[1]) });
  }

  // export [type] ... from 'x'（桶文件再导出同样构成依赖）
  const exportRe = /export\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(exportRe)) {
    out.push({ spec: m[2], typeOnly: Boolean(m[1]) });
  }

  // import 'x'（副作用导入）
  const sideEffectRe = /import\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(sideEffectRe)) {
    out.push({ spec: m[1], typeOnly: false });
  }

  return out;
}

// ============================================================
// 违规规则
// ============================================================

interface Violation {
  rule: string;
  file: string;
  detail: string;
}

const RULE_TITLES: Record<string, string> = {
  'R1-UPWARD': '反向依赖：上游层被下游层 import（Controller ← Business ← Operation ← Data 方向必须单向）',
  'R2-CONTROLLER-PRISMA': 'Controller/Routes 直接访问 Prisma（禁止；应经 Business/Operation/Data 层）',
  'R3-SHARED-BUSINESS': '共享基础设施（lib/utils/middleware）依赖业务层（禁止反向依赖）',
  'R4-HTTP-IN-DOMAIN': 'Business/Operation/Data 层依赖 HTTP 框架（禁止；HTTP 只在 Controller 边界）',
  'R5-STATE-PURITY': 'State 能力越界（禁止 Prisma / HTTP / 业务层依赖；State 只能是纯规则）',
};

function checkFile(file: string, violations: Violation[]): void {
  const ownLayer = layerOfFile(file);
  const rel = relativeToSrc(file);
  const imports = extractImports(fs.readFileSync(file, 'utf8'));

  for (const { spec, typeOnly } of imports) {
    const resolved = resolveSpecifier(file, spec);
    const isExternal = resolved === null;

    // R2：Controller / Routes 不得直接访问 Prisma
    if ((ownLayer === 'controllers' || ownLayer === 'routes') && resolved) {
      if (relativeToSrc(resolved) === 'lib/prisma.ts') {
        violations.push({ rule: 'R2-CONTROLLER-PRISMA', file: rel, detail: `import '${spec}'` });
      }
    }

    // R4：领域层不得依赖 HTTP 框架
    if (ownLayer === 'services' || ownLayer === 'operations' || ownLayer === 'repositories') {
      const isHttp =
        HTTP_PACKAGES.includes(spec) || HTTP_PACKAGE_PREFIXES.some((p) => spec.startsWith(p));
      if (isExternal && isHttp) {
        violations.push({ rule: 'R4-HTTP-IN-DOMAIN', file: rel, detail: `import '${spec}'` });
      }
    }

    // R5：State 能力必须保持纯规则（不得 Prisma / HTTP / 业务层依赖）
    if (ownLayer === 'state') {
      const isHttp =
        HTTP_PACKAGES.includes(spec) || HTTP_PACKAGE_PREFIXES.some((p) => spec.startsWith(p));
      const target = resolved ? relativeToSrc(resolved) : '';
      const hitsBusinessLayer =
        !!resolved &&
        ['controllers', 'services', 'operations', 'repositories'].includes(target.split('/')[0]);
      if ((isExternal && isHttp) || target === 'lib/prisma.ts' || hitsBusinessLayer) {
        violations.push({ rule: 'R5-STATE-PURITY', file: rel, detail: `import '${spec}'` });
      }
    }

    if (!resolved) continue;
    const targetLayer = layerOfFile(resolved);

    // R1：业务层之间的方向必须向下或同级
    if (ownLayer in RANK && targetLayer in RANK) {
      const own = RANK[ownLayer as RankedLayer];
      const target = RANK[targetLayer as RankedLayer];
      if (target < own) {
        violations.push({
          rule: 'R1-UPWARD',
          file: rel,
          detail: `${ownLayer} → ${targetLayer}（${spec}）`,
        });
      }
    }

    // R3：共享基础设施不得依赖业务层（type-only 视为仅类型引用，不构成运行时耦合）
    if (SHARED_LAYERS.includes(ownLayer as SharedLayer) && targetLayer in RANK && !typeOnly) {
      violations.push({
        rule: 'R3-SHARED-BUSINESS',
        file: rel,
        detail: `${ownLayer} → ${targetLayer}（${spec}）`,
      });
    }
  }
}

// ============================================================
// 指标
// ============================================================

interface Metrics {
  total: number;
  perLayer: Record<string, number>;
  controllers: number;
  controllersWithPrisma: number;
  controllerPrismaCallSites: number;
}

function collectMetrics(files: string[]): Metrics {
  const perLayer: Record<string, number> = {};
  let controllers = 0;
  let controllersWithPrisma = 0;
  let controllerPrismaCallSites = 0;

  for (const file of files) {
    const layer = layerOfFile(file);
    perLayer[layer] = (perLayer[layer] ?? 0) + 1;

    if (layer === 'controllers') {
      controllers += 1;
      const code = fs.readFileSync(file, 'utf8');
      const calls = code.match(/\bprisma\./g);
      if (calls && calls.length > 0) {
        controllersWithPrisma += 1;
        controllerPrismaCallSites += calls.length;
      }
    }
  }

  return { total: files.length, perLayer, controllers, controllersWithPrisma, controllerPrismaCallSites };
}

// ============================================================
// 主流程
// ============================================================

function main(): void {
  const strict = process.argv.includes('--strict');
  const files = listTsFiles(SRC_ROOT);
  const metrics = collectMetrics(files);

  const violations: Violation[] = [];
  for (const file of files) checkFile(file, violations);

  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule)!.push(v);
  }

  console.log('');
  console.log('========================================');
  console.log(' 分层依赖检查（Round R-1 Foundation）');
  console.log('========================================');
  console.log('');
  console.log('依赖方向（必须单向）：');
  console.log('  Controller → Business(services) → Operation(operations) → Data(repositories) → Prisma');
  console.log('');

  console.log('--- FILES BY LAYER ---');
  for (const key of Object.keys(metrics.perLayer).sort()) {
    console.log(`  ${key.padEnd(14)} ${metrics.perLayer[key]}`);
  }
  console.log(`  ${'TOTAL'.padEnd(14)} ${metrics.total}`);
  console.log('');

  console.log('--- METRICS（迁移进度）---');
  console.log(`  业务层文件：controllers=${metrics.perLayer.controllers ?? 0} services=${
    metrics.perLayer.services ?? 0
  } operations=${metrics.perLayer.operations ?? 0} repositories=${metrics.perLayer.repositories ?? 0}`);
  console.log(`  State 能力文件：${metrics.perLayer.state ?? 0}（必须保持纯规则）`);
  console.log(`  Controller 总数：${metrics.controllers}`);
  console.log(`  仍直接 import Prisma 的 Controller：${metrics.controllersWithPrisma}`);
  console.log(`  Controller 内 prisma.* 调用点：${metrics.controllerPrismaCallSites}`);
  const progress =
    metrics.controllers === 0
      ? 100
      : Math.round(((metrics.controllers - metrics.controllersWithPrisma) / metrics.controllers) * 100);
  console.log(`  分层迁移进度（Controller 去 Prisma 化）：${progress}%`);
  console.log('');

  console.log('--- VIOLATIONS（迁移点清单）---');
  if (violations.length === 0) {
    console.log('  无');
  } else {
    const ruleOrder = ['R1-UPWARD', 'R2-CONTROLLER-PRISMA', 'R3-SHARED-BUSINESS', 'R4-HTTP-IN-DOMAIN', 'R5-STATE-PURITY'];
    for (const rule of ruleOrder) {
      const list = byRule.get(rule);
      if (!list || list.length === 0) continue;
      console.log('');
      console.log(`  [${rule}] ${RULE_TITLES[rule] ?? ''}`);
      console.log(`  命中 ${list.length} 处：`);
      // 同一规则同一文件只展示一行（import 行数较多时避免刷屏）
      const seen = new Set<string>();
      for (const v of list) {
        if (seen.has(v.file)) continue;
        seen.add(v.file);
        console.log(`    - ${v.file}  ::  ${v.detail}`);
      }
      if (seen.size !== list.length) {
        console.log(`    （共 ${list.length} 处 import，上文按文件去重展示 ${seen.size} 个文件）`);
      }
    }
  }
  console.log('');
  console.log(`违规总数：${violations.length}`);
  console.log('');

  if (strict && violations.length > 0) {
    console.log('严格模式：存在违规，退出码 1。');
    process.exitCode = 1;
  } else if (!strict && violations.length > 0) {
    console.log('报告模式：仅记录迁移点，不阻断（如需阻断请加 --strict）。');
  }
}

main();
