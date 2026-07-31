import { Input, Button } from 'antd';
import {
  SearchOutlined, AppstoreOutlined, UnorderedListOutlined,
  UploadOutlined, ReloadOutlined, PlusOutlined,
} from '@ant-design/icons';
import TagSelector from '../TagSelector';

const FILTER_OPTIONS: { key: 'all' | 'new' | 'old' | 'noOrder' | 'done' | 'key' | 'public'; label: string }[] = [
  { key: 'all', label: '我的客户' },
  { key: 'new', label: '新客户' },
  { key: 'old', label: '老客户' },
  { key: 'noOrder', label: '未成交' },
  { key: 'done', label: '已成交' },
  { key: 'key', label: '重点客户' },
  { key: 'public', label: '公海客户' },
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
  filterType: 'all' | 'new' | 'old' | 'noOrder' | 'done' | 'key' | 'public';
  setFilterType: (v: 'all' | 'new' | 'old' | 'noOrder' | 'done' | 'key' | 'public') => void;
  setImportOpen: (v: boolean) => void;
  openCreate: () => void;
}

export default function CustomerToolbar({
  token, keyword, setKeyword, fetchData, setPage,
  viewMode, setViewMode, filterTags, setFilterTags,
  filterType, setFilterType,
  setImportOpen, openCreate,
}: CustomerToolbarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <Input
        prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
        placeholder="搜索客户名、国家、联系人..."
        style={{ width: 280, borderRadius: 8, height: 36 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={() => { setPage(1); fetchData(); }}
        allowClear
      />

      {/* 客户类型胶囊筛选 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          background: '#f1f5f9',
          borderRadius: 24,
          padding: '3px 4px',
        }}
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = filterType === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => { setFilterType(opt.key); setPage(1); }}
              style={{
                border: 'none',
                outline: 'none',
                cursor: 'pointer',
                padding: '5px 12px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                transition: 'all 0.25s ease',
                background: active ? '#1677ff' : 'transparent',
                color: active ? '#fff' : '#64748b',
                boxShadow: active ? '0 2px 8px rgba(22,119,255,0.3)' : 'none',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <TagSelector
        value={filterTags}
        onChange={(v) => { setFilterTags(v); setPage(1); }}
        placeholder="输入标签名称"
        showAddButton={false}
      />

      <div style={{ flex: 1 }} />

      {/* 视图切换 - 图标 */}
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
      <Button icon={<ReloadOutlined />} onClick={fetchData} style={{ borderRadius: 8 }}>
        刷新
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 8 }}>
        新增客户
      </Button>
    </div>
  );
}