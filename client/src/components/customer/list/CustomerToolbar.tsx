import { Input, Button, Select } from 'antd';
import {
  SearchOutlined,
  UploadOutlined, PlusOutlined,
} from '@ant-design/icons';
import TagSelector from '../../TagSelector';
import { INTENT_LABEL } from '../shared/intentLevel';
import ViewModeSwitch from '../../common/ViewModeSwitch';
import PageToolbar from '../../common/page/PageToolbar';
import CapsuleSwitch from '../../common/CapsuleSwitch';
import type { UserSelectItem } from '../../../api/users';

type FilterType = 'all' | 'noOrder' | 'done' | 'key' | 'public';

const MAIN_FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: '我的客户' },
  { key: 'key', label: '重点客户' },
  { key: 'public', label: '公海客户' },
  { key: 'noOrder', label: '未成交' },
  { key: 'done', label: '已成交' },
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

interface CustomerToolbarProps {
  token: any;
  keyword: string;
  setKeyword: (v: string) => void;
  fetchData: () => void;
  setPage: (v: number) => void;
  viewMode: 'card' | 'list';
  setViewMode: (v: 'card' | 'list') => void;
  filterTags: string;
  setFilterTags: (v: string) => void;
  filterType: FilterType;
  setFilterType: (v: FilterType) => void;
  subFilterType: string;
  setSubFilterType: (v: string) => void;
  setImportOpen: (v: boolean) => void;
  openCreate: () => void;
  isAdmin: boolean;
  filterTypePublic: boolean;
  selectedOwnerId: string;
  setSelectedOwnerId: (v: string) => void;
  userList: UserSelectItem[];
  noOrderBreakdown?: Record<string, number>;
  doneBreakdown?: Record<string, number>;
}

export default function CustomerToolbar({
  token, keyword, setKeyword, fetchData, setPage,
  viewMode, setViewMode, filterTags, setFilterTags,
  filterType, setFilterType, subFilterType, setSubFilterType,
  setImportOpen, openCreate,
  isAdmin, filterTypePublic, selectedOwnerId, setSelectedOwnerId, userList,
  noOrderBreakdown, doneBreakdown,
}: CustomerToolbarProps) {
  const showNoOrderSub = filterType === 'noOrder';
  const showDoneSub = filterType === 'done';

  const handleFilterChange = (next: FilterType) => {
    setFilterType(next);
    setSubFilterType('');
    setPage(1);
  };

  const handleSubFilterChange = (next: string) => {
    setSubFilterType(next);
    setPage(1);
  };

  return (
    <PageToolbar
      actions={
        <>
          <ViewModeSwitch value={viewMode} onChange={setViewMode} />
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)} style={{ borderRadius: 8 }}>
            导入
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 8 }}>
            新增客户
          </Button>
        </>
      }
      extra={
        (showNoOrderSub || showDoneSub) ? (
          <CapsuleSwitch
            tone="sub"
            value={subFilterType}
            onChange={handleSubFilterChange}
            activeColor="#1677ff"
            options={(showNoOrderSub ? NO_ORDER_SUB_FILTERS : DONE_SUB_FILTERS).map((opt) => ({
              key: opt.key,
              label: opt.label,
              count: showNoOrderSub
                ? (noOrderBreakdown?.[opt.key] ?? 0)
                : (doneBreakdown?.[opt.key] ?? 0),
            }))}
          />
        ) : undefined
      }
    >
      <Input
        prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
        placeholder="搜索客户名、国家、联系人..."
        style={{ flex: '1 1 220px', minWidth: 160, maxWidth: 280, borderRadius: 8, height: 36 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={() => { setPage(1); fetchData(); }}
        allowClear
      />

      <CapsuleSwitch<FilterType>
        value={filterType}
        onChange={handleFilterChange}
        activeColor="#1677ff"
        showCount={false}
        options={MAIN_FILTERS.map((opt) => ({
          key: opt.key,
          label: opt.key === 'all' && isAdmin ? '团队客户' : opt.label,
        }))}
      />

      <TagSelector
        value={filterTags}
        onChange={(v) => { setFilterTags(v); setPage(1); }}
        placeholder="输入标签名称"
        showAddButton={false}
      />

      {isAdmin && !filterTypePublic && (
        <Select
          placeholder="筛选业务员"
          value={selectedOwnerId || undefined}
          onChange={(v) => { setSelectedOwnerId(v || ''); setPage(1); }}
          allowClear
          style={{ flex: '0 1 160px', minWidth: 140, borderRadius: 8 }}
          showSearch
          filterOption={(input: string, option: any) =>
            (option?.label?.toLowerCase() ?? '').includes((input ?? '').toLowerCase())
          }
          options={userList.map((u: UserSelectItem) => ({
              value: u.id,
              label: u.realName || u.username,
            }))}
        />
      )}
    </PageToolbar>
  );
}
