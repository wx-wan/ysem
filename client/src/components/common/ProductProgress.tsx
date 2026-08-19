import React, { useMemo } from 'react';
import { Button, Tag, Tooltip, Empty } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  EditOutlined,
} from '@ant-design/icons';
import './ProductProgress.css';

// ===================== 类型 =====================
export interface ProgressStep {
  key: string;
  label: string;
  done: boolean;
  group?: string; // 子流程分组（如「后续设计」「工厂打样」）
}

export interface ProgressStage {
  id: string;
  name: string; // 打样/报价 批次名（可多个并行）
  steps: ProgressStep[];
}

export interface ProductProgressData {
  sampling: ProgressStage[]; // 打样子任务（可多个并行）
  quoting: ProgressStage[]; // 报价子任务（可多个并行）
}

export type ProductPhase = 'new' | 'sampling' | 'quoting' | 'done';

// ===================== 默认模板 =====================
// 打样：后续设计（画图 / 3D打印 / 安排模具 → 移交模具店 / 安排下缸 / 模种到场）
//       工厂打样（夹具 / 钢板 / 大货模 / 包装辅材 / 组装辅材 / 打样完成）
const SAMPLING_TEMPLATE: Omit<ProgressStep, 'done'>[] = [
  { key: 'draw', label: '画图', group: '后续设计' },
  { key: 'print3d', label: '3D打印', group: '后续设计' },
  { key: 'mold_transfer', label: '移交模具店', group: '安排模具' },
  { key: 'mold_cylinder', label: '安排下缸', group: '安排模具' },
  { key: 'mold_arrive', label: '模种到场', group: '安排模具' },
  { key: 'fixture', label: '夹具', group: '工厂打样' },
  { key: 'steel', label: '钢板', group: '工厂打样' },
  { key: 'mass_mold', label: '大货模', group: '工厂打样' },
  { key: 'pkg_aux', label: '包装辅材', group: '工厂打样' },
  { key: 'asm_aux', label: '组装辅材', group: '工厂打样' },
  { key: 'sample_done', label: '打样完成', group: '工厂打样' },
];

const QUOTING_TEMPLATE: Omit<ProgressStep, 'done'>[] = [
  { key: 'quote_done', label: '报价完成' },
];

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function buildStage(kind: 'sampling' | 'quoting', name: string): ProgressStage {
  const tpl = kind === 'sampling' ? SAMPLING_TEMPLATE : QUOTING_TEMPLATE;
  return {
    id: genId(kind),
    name,
    steps: tpl.map((s) => ({ ...s, done: false })),
  };
}

export function emptyProgress(): ProductProgressData {
  return { sampling: [], quoting: [] };
}

export function parseProgress(value?: string | null): ProductProgressData {
  if (!value) return emptyProgress();
  try {
    const data = JSON.parse(value) as Partial<ProductProgressData>;
    return {
      sampling: Array.isArray(data.sampling) ? data.sampling : [],
      quoting: Array.isArray(data.quoting) ? data.quoting : [],
    };
  } catch {
    return emptyProgress();
  }
}

// 计算整体阶段
export function getProgressPhase(value?: string | null): { phase: ProductPhase; label: string } {
  return computePhase(parseProgress(value));
}

// 状态标签颜色（单一真相源：主蓝锚点 + 语义色，冷色系协调）
// new=中性冷灰、sampling=主蓝(进行中)、quoting=柔和金(次线进行中)、done=完成绿
export const STATUS_TAG_COLOR: Record<ProductPhase, string> = {
  new: 'default',
  sampling: 'processing',
  quoting: 'gold',
  done: 'success',
};

function computePhase(d: ProductProgressData): { phase: ProductPhase; label: string } {
  const hasSampling = d.sampling.length > 0;
  const hasQuoting = d.quoting.length > 0;
  if (!hasSampling && !hasQuoting) return { phase: 'new', label: '新建' };
  const samplingAllDone = hasSampling && d.sampling.every((s) => s.steps.every((st) => st.done));
  const quotingAllDone = hasQuoting && d.quoting.every((s) => s.steps.every((st) => st.done));
  if (hasSampling && !samplingAllDone) return { phase: 'sampling', label: '打样中' };
  if (hasQuoting && !quotingAllDone) return { phase: 'quoting', label: '报价中' };
  if (samplingAllDone && quotingAllDone) return { phase: 'done', label: '已完成' };
  return { phase: 'sampling', label: '打样中' };
}

// ===================== 组件 =====================
interface ProductProgressProps {
  value?: string | null; // JSON 字符串
  onChange?: (json: string) => void;
  editable?: boolean; // true=弹窗内可编辑，false=图片下方只读展示
}

const PHASE_COLORS: Record<ProductPhase, string> = {
  new: 'default',
  sampling: 'processing',
  quoting: 'warning',
  done: 'success',
};

const ProductProgress: React.FC<ProductProgressProps> = ({ value, onChange, editable = false }) => {
  const data = useMemo(() => parseProgress(value), [value]);
  const { phase, label } = useMemo(() => computePhase(data), [data]);

  const commit = (next: ProductProgressData) => {
    onChange?.(JSON.stringify(next));
  };

  // ---- 编辑操作 ----
  const addStage = (kind: 'sampling' | 'quoting') => {
    const next = { ...data };
    const arr = kind === 'sampling' ? next.sampling : next.quoting;
    const idx = arr.length + 1;
    const name = kind === 'sampling' ? `打样 ${idx}` : `报价 ${idx}`;
    arr.push(buildStage(kind, name));
    commit(next);
  };

  const removeStage = (kind: 'sampling' | 'quoting', id: string) => {
    const next = { ...data };
    if (kind === 'sampling') next.sampling = next.sampling.filter((s) => s.id !== id);
    else next.quoting = next.quoting.filter((s) => s.id !== id);
    commit(next);
  };

  const toggleStep = (kind: 'sampling' | 'quoting', stageId: string, stepKey: string) => {
    const next = { ...data };
    const arr = kind === 'sampling' ? next.sampling : next.quoting;
    const stage = arr.find((s) => s.id === stageId);
    if (!stage) return;
    stage.steps = stage.steps.map((st) =>
      st.key === stepKey ? { ...st, done: !st.done } : st,
    );
    commit(next);
  };

  // ---- 渲染单个阶段（含子流程分组）----
  const renderStageSteps = (kind: 'sampling' | 'quoting', stage: ProgressStage) => {
    let lastGroup = '';
    return (
      <div className="pp-steps">
        {stage.steps.map((st) => {
          const groupChanged = (st.group ?? '') !== lastGroup;
          lastGroup = st.group ?? '';
          return (
            <React.Fragment key={st.key}>
              {groupChanged && st.group && <div className="pp-subgroup">{st.group}</div>}
              <div
                className={`pp-step ${st.done ? 'is-done' : ''} ${editable ? 'is-editable' : ''}`}
                onClick={editable ? () => toggleStep(kind, stage.id, st.key) : undefined}
              >
                <span className="pp-step-icon">
                  {st.done ? <CheckCircleFilled /> : <CheckCircleOutlined />}
                </span>
                <span className="pp-step-label">{st.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // ---- 总进度（已完成步骤 / 总步骤）----
  const allSteps = [...data.sampling, ...data.quoting].flatMap((s) => s.steps);
  const doneCount = allSteps.filter((s) => s.done).length;
  const totalCount = allSteps.length;

  // ============ 只读展示（图片下方）============
  if (!editable) {
    if (totalCount === 0 && data.sampling.length === 0 && data.quoting.length === 0) {
      return (
        <div className="pp-root">
          <div className="pp-header">
            <span className="pp-title">产品状态</span>
            <Tag color={PHASE_COLORS[phase]}>{label}</Tag>
          </div>
          <Empty
            className="pp-empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无进度，进入编辑可添加打样 / 报价"
          />
        </div>
      );
    }
    return (
      <div className="pp-root">
        <div className="pp-header">
          <span className="pp-title">产品状态</span>
          <Tag color={PHASE_COLORS[phase]}>{label}</Tag>
          {totalCount > 0 && (
            <span className="pp-count">
              {doneCount}/{totalCount}
            </span>
          )}
        </div>

        {/* 阶段流程条：新建 → 打样 → 报价 → 完成 */}
        <div className="pp-flow">
          <span className={`pp-flow-node ${phase === 'new' ? 'active' : phase !== 'new' ? 'passed' : ''}`}>
            新建
          </span>
          <span className="pp-flow-line" />
          <span className={`pp-flow-node ${data.sampling.length ? (phase === 'sampling' ? 'active' : 'passed') : ''}`}>
            打样
          </span>
          <span className="pp-flow-line" />
          <span className={`pp-flow-node ${data.quoting.length ? (phase === 'quoting' ? 'active' : phase === 'done' ? 'passed' : '') : ''}`}>
            报价
          </span>
          <span className="pp-flow-line" />
          <span className={`pp-flow-node ${phase === 'done' ? 'active' : ''}`}>完成</span>
        </div>

        {data.sampling.length > 0 && (
          <div className="pp-group-block">
            <div className="pp-group-title">打样（{data.sampling.length}）</div>
            {data.sampling.map((stage) => {
              const sDone = stage.steps.filter((s) => s.done).length;
              return (
                <div className="pp-stage" key={stage.id}>
                  <div className="pp-stage-head">
                    <span className="pp-stage-name">{stage.name}</span>
                    <span className="pp-stage-count">
                      {sDone}/{stage.steps.length}
                    </span>
                  </div>
                  {renderStageSteps('sampling', stage)}
                </div>
              );
            })}
          </div>
        )}

        {data.quoting.length > 0 && (
          <div className="pp-group-block">
            <div className="pp-group-title">报价（{data.quoting.length}）</div>
            {data.quoting.map((stage) => {
              const sDone = stage.steps.filter((s) => s.done).length;
              return (
                <div className="pp-stage" key={stage.id}>
                  <div className="pp-stage-head">
                    <span className="pp-stage-name">{stage.name}</span>
                    <span className="pp-stage-count">
                      {sDone}/{stage.steps.length}
                    </span>
                  </div>
                  {renderStageSteps('quoting', stage)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ============ 编辑模式（弹窗内）============
  return (
    <div className="pp-root pp-edit">
      <div className="pp-header">
        <span className="pp-title">产品状态 / 进度</span>
        <Tag color={PHASE_COLORS[phase]}>{label}</Tag>
        {totalCount > 0 && (
          <span className="pp-count">
            {doneCount}/{totalCount}
          </span>
        )}
      </div>

      <div className="pp-edit-blocks">
        <div className="pp-edit-block">
          <div className="pp-edit-block-head">
            <span className="pp-group-title">打样</span>
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addStage('sampling')}>
              添加打样
            </Button>
          </div>
          {data.sampling.length === 0 && <div className="pp-hint">尚未添加打样子任务</div>}
          {data.sampling.map((stage) => (
            <div className="pp-stage pp-stage-edit" key={stage.id}>
              <div className="pp-stage-head">
                <span className="pp-stage-name">
                  <EditOutlined /> {stage.name}
                </span>
                <Tooltip title="删除该打样子任务">
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeStage('sampling', stage.id)}
                  />
                </Tooltip>
              </div>
              {renderStageSteps('sampling', stage)}
            </div>
          ))}
        </div>

        <div className="pp-edit-block">
          <div className="pp-edit-block-head">
            <span className="pp-group-title">报价</span>
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addStage('quoting')}>
              添加报价
            </Button>
          </div>
          {data.quoting.length === 0 && <div className="pp-hint">尚未添加报价子任务</div>}
          {data.quoting.map((stage) => (
            <div className="pp-stage pp-stage-edit" key={stage.id}>
              <div className="pp-stage-head">
                <span className="pp-stage-name">
                  <EditOutlined /> {stage.name}
                </span>
                <Tooltip title="删除该报价子任务">
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeStage('quoting', stage.id)}
                  />
                </Tooltip>
              </div>
              {renderStageSteps('quoting', stage)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProductProgress;
