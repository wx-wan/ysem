import { Input, Select } from 'antd';
import { INTENT_LABEL } from '../shared/intentLevel';
import FilterToolbar, { FilterGroup } from '../../common/FilterToolbar';
import CapsuleSwitch from '../../common/CapsuleSwitch';
import type { UserSelectItem } from '../../../api/users';

/** 数据范围（切换栏）：我的 / 团队（管理员）/ 公海 */
export type CustomerScopeTab = 'mine' | 'team' | 'public';
/** 成交状态筛选：'' = 不限 */
export type CustomerDealStatus = '' | 'noOrder' | 'done';

const DEAL_STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'noOrder', label: '未成交' },
  { key: 'done', label: '已成交' },
];

/** 客户级别（isKeyAccount）：与成交状态正交，可叠加 */
const KEY_LEVEL_OPTIONS: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'key', label: '重点客户' },
];

const NO_ORDER_SUB_FILTERS: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'A', label: INTENT_LABEL.A },
  { key: 'B', label: INTENT_LABEL.B },
  { key: 'C', label: INTENT_LABEL.C },
  { key: 'D', label: INTENT_LABEL.D },
  { key: 'none', label: '待开发' },
];

const DONE_SUB_FILTERS: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'new', label: '本年度新客' },
  { key: 'old', label: '往年老客' },
];

/** 排序方式：默认智能排序（业务优先级），可切换为按创建时间升 / 降序 */
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'smart', label: '智能排序' },
  { value: 'createdAt:desc', label: '按创建时间降序' },
  { value: 'createdAt:asc', label: '按创建时间升序' },
];

interface CustomerToolbarProps {
  /** 搜索框输入值（本地态，由页面持有并防抖提交） */
  searchValue: string;
  onSearchChange: (v: string) => void;
  /** 回车立即提交搜索 */
  onSearchSubmit?: () => void;
  setPage: (v: number) => void;
  /** 结果总数（第二行「共 N 条结果」） */
  total: number;
  /** 排序方式（smart / createdAt:desc / createdAt:asc） */
  sortValue: string;
  onSortChange: (v: string) => void;
  /** 范围切换（常驻第二行）：我的 / 团队（管理员）/ 公海 */
  scopeTab: CustomerScopeTab;
  onScopeChange: (v: CustomerScopeTab) => void;
  /** 筛选条件（展开面板） */
  dealStatus: CustomerDealStatus;
  onDealStatusChange: (v: string) => void;
  intentSub: string;
  onIntentSubChange: (v: string) => void;
  keyOnly: boolean;
  onKeyOnlyChange: (v: boolean) => void;
  isAdmin: boolean;
  /** 标签关键词（本地输入态，由页面持有并防抖提交；对客户标签做模糊匹配） */
  tagValue: string;
  onTagChange: (v: string) => void;
  /** 回车立即提交标签筛选 */
  onTagSubmit?: () => void;
  /** 清除全部筛选条件（数据范围切换保留） */
  onClearFilters: () => void;
  selectedOwnerId: string;
  setSelectedOwnerId: (v: string) => void;
  userList: UserSelectItem[];
  noOrderBreakdown?: Record<string, number>;
  doneBreakdown?: Record<string, number>;
}

/**
 * 客户列表筛选栏：交互方式与线索页保持一致（搜索 + 「筛选」展开面板 + 范围切换 + 结果数 + 清除筛选）。
 * 第二行只保留数据范围（我的 / 团队 / 公海）；客户分类（成交状态、采购意向 / 客户类型、重点客户）
 * 统一收进「筛选」展开面板作为筛选条件。
 */
export default function CustomerToolbar({
  searchValue, onSearchChange, onSearchSubmit, setPage, total,
  sortValue, onSortChange,
  scopeTab, onScopeChange,
  dealStatus, onDealStatusChange, intentSub, onIntentSubChange,
  keyOnly, onKeyOnlyChange, isAdmin,
  tagValue, onTagChange, onTagSubmit, onClearFilters,
  selectedOwnerId, setSelectedOwnerId, userList,
  noOrderBreakdown, doneBreakdown,
}: CustomerToolbarProps) {
  // 业务员筛选仅在管理员「团队」范围下有意义（「我的」已锁定本人、公海无归属人）
  const showOwnerFilter = isAdmin && scopeTab === 'team';
  const subOptions = dealStatus === 'done' ? DONE_SUB_FILTERS : NO_ORDER_SUB_FILTERS;
  const subCounts = dealStatus === 'done' ? doneBreakdown : noOrderBreakdown;
  // 角标 / 清除筛选统计展开面板内的条件（范围切换常驻可见，不计入）
  const activeCount =
    (dealStatus ? 1 : 0) + (intentSub ? 1 : 0) + (keyOnly ? 1 : 0) +
    (tagValue ? 1 : 0) + (showOwnerFilter && selectedOwnerId ? 1 : 0);

  return (
    <FilterToolbar
      searchPlaceholder="搜索客户名、国家、联系人..."
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      onSearchSubmit={onSearchSubmit}
      sortOptions={SORT_OPTIONS}
      sortValue={sortValue}
      onSortChange={onSortChange}
      activeCount={activeCount}
      onClear={onClearFilters}
      total={total}
      tabs={
        <CapsuleSwitch<CustomerScopeTab>
          value={scopeTab}
          onChange={onScopeChange}
          activeColor="#1677ff"
          showCount={false}
          options={[
            { key: 'mine', label: '我的' },
            // 「团队」= 全公司已分配客户；仅管理员可见
            ...(isAdmin ? [{ key: 'team' as const, label: '团队' }] : []),
            { key: 'public', label: '公海' },
          ]}
        />
      }
    >
      <FilterGroup
        label="成交状态"
        value={dealStatus}
        onChange={onDealStatusChange}
        options={DEAL_STATUS_OPTIONS}
      />

      {(dealStatus === 'noOrder' || dealStatus === 'done') && (
        <FilterGroup
          label={dealStatus === 'noOrder' ? '采购意向' : '客户类型'}
          value={intentSub}
          onChange={onIntentSubChange}
          options={subOptions.map((opt) => ({
            key: opt.key,
            label: opt.label,
            count: subCounts?.[opt.key] ?? 0,
          }))}
        />
      )}

      <FilterGroup
        label="客户级别"
        value={keyOnly ? 'key' : ''}
        onChange={(key) => onKeyOnlyChange(key === 'key')}
        options={KEY_LEVEL_OPTIONS}
      />

      {/* 标签筛选：输入关键词即对客户标签做模糊匹配（大小写不敏感的子串） */}
      <FilterGroup label="客户标签">
        <Input
          allowClear
          placeholder="输入标签关键词"
          value={tagValue}
          onChange={(e) => onTagChange(e.target.value)}
          onPressEnter={onTagSubmit}
        />
      </FilterGroup>

      {showOwnerFilter && (
        <FilterGroup label="业务员">
          <Select
            placeholder="筛选业务员"
            value={selectedOwnerId || undefined}
            onChange={(v) => { setSelectedOwnerId(v || ''); setPage(1); }}
            allowClear
            style={{ width: '100%' }}
            showSearch
            filterOption={(input: string, option: any) =>
              (option?.label?.toLowerCase() ?? '').includes((input ?? '').toLowerCase())
            }
            options={userList.map((u: UserSelectItem) => ({
              value: u.id,
              label: u.realName || u.username,
            }))}
          />
        </FilterGroup>
      )}
    </FilterToolbar>
  );
}
