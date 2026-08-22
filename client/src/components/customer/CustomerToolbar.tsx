import { Input, Button, Select } from 'antd';
import {
  SearchOutlined, AppstoreOutlined, UnorderedListOutlined,
  UploadOutlined, PlusOutlined,
} from '@ant-design/icons';
import TagSelector from '../TagSelector';
import CapsuleSwitch from '../common/CapsuleSwitch';
import { INTENT_LABEL } from './shared/intentLevel';
import type { User } from '../../api/users';

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
  userList: User[];
}

export default function CustomerToolbar({
  token, keyword, setKeyword, fetchData, setPage,
  viewMode, setViewMode, filterTags, setFilterTags,
  filterType, setFilterType, subFilterType, setSubFilterType,
  setImportOpen, openCreate,
  isAdmin, filterTypePublic, selectedOwnerId, setSelectedOwnerId, userList,
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
    <div style={{ marginBottom: 16 }}>
      {/* 主工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
          placeholder="搜索客户名、国家、联系人..."
          style={{ width: 280, borderRadius: 8, height: 36 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => { setPage(1); fetchData(); }}
          allowClear
        />

        {/* 主筛选胶囊 */}
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
            style={{ width: 160, borderRadius: 8 }}
            showSearch
            filterOption={(input: string, option: any) =>
              (option?.label?.toLowerCase() ?? '').includes((input ?? '').toLowerCase())
            }
            options={userList
              .filter((u: User) => u.status === 'ACTIVE')
              .map((u: User) => ({
                value: u.id,
                label: u.realName || u.username,
              }))}
          />
        )}

        <div style={{ flex: 1 }} />

        {/* 视图切换 */}
        <div style={{
          display: 'flex',
          background: '#f1f5f9',
          borderRadius: 8,
          padding: 2,
        }}>
          <button
            onClick={() => setViewMode('card')}
            title="卡片视图"
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 6,
              background: viewMode === 'card' ? '#fff' : 'transparent',
              color: viewMode === 'card' ? token.colorPrimary : token.colorTextSecondary,
              boxShadow: viewMode === 'card' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <AppstoreOutlined />
          </button>
          <button
            onClick={() => setViewMode('list')}
            title="列表视图"
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 6,
              background: viewMode === 'list' ? '#fff' : 'transparent',
              color: viewMode === 'list' ? token.colorPrimary : token.colorTextSecondary,
              boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <UnorderedListOutlined />
          </button>
        </div>

        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)} style={{ borderRadius: 8 }}>
          导入
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 8 }}>
          新增客户
        </Button>
      </div>

      {/* 子筛选栏 */}
      {(showNoOrderSub || showDoneSub) && (
        <div style={{ marginTop: 10 }}>
          <CapsuleSwitch
            tone="sub"
            value={subFilterType}
            onChange={handleSubFilterChange}
            activeColor="#1677ff"
            showCount={false}
            options={showNoOrderSub ? NO_ORDER_SUB_FILTERS : DONE_SUB_FILTERS}
          />
        </div>
      )}
    </div>
  );
}
