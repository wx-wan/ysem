import { Input, Select, Segmented, Button } from 'antd';
import {
  SearchOutlined, AppstoreOutlined, UnorderedListOutlined,
  UploadOutlined, ReloadOutlined, PlusOutlined,
} from '@ant-design/icons';
import TagSelector from '../TagSelector';
import type { User } from '../../api/users';

interface CustomerToolbarProps {
  token: any;
  keyword: string;
  setKeyword: (v: string) => void;
  fetchData: () => void;
  setPage: (v: number) => void;
  viewMode: 'card' | 'list';
  setViewMode: (v: 'card' | 'list') => void;
  isAdmin: boolean;
  selectedOwnerId: string;
  setSelectedOwnerId: (v: string) => void;
  userList: User[];
  filterTags: string;
  setFilterTags: (v: string) => void;
  setImportOpen: (v: boolean) => void;
  openCreate: () => void;
}

export default function CustomerToolbar({
  token, keyword, setKeyword, fetchData, setPage,
  viewMode, setViewMode, isAdmin, selectedOwnerId,
  setSelectedOwnerId, userList, filterTags, setFilterTags,
  setImportOpen, openCreate,
}: CustomerToolbarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
      <Input
        prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
        placeholder="搜索客户名、国家、联系人..."
        style={{ width: 320, borderRadius: 8, height: 36 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={() => { setPage(1); fetchData(); }}
        allowClear
      />

      <Segmented
        className="view-mode-segmented"
        value={viewMode}
        onChange={(v) => setViewMode(v as 'card' | 'list')}
        options={[
          { value: 'card', label: <span><AppstoreOutlined style={{ marginRight: 4 }} />卡片</span> },
          { value: 'list', label: <span><UnorderedListOutlined style={{ marginRight: 4 }} />列表</span> },
        ]}
      />

      {isAdmin && (
        <Select
          placeholder="筛选业务员"
          value={selectedOwnerId || undefined}
          onChange={(v) => { setSelectedOwnerId(v || ''); setPage(1); }}
          allowClear
          style={{ width: 180, borderRadius: 8 }}
          showSearch
          filterOption={(input: string, option: any) =>
            option?.label?.toLowerCase().includes(input.toLowerCase())
          }
          options={userList
            .filter((u: User) => u.status === 'ACTIVE')
            .map((u: User) => ({
              value: u.id,
              label: u.realName || u.username,
            }))}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TagSelector
          value={filterTags}
          onChange={(v) => { setFilterTags(v); setPage(1); }}
          placeholder="输入标签名称"
          showAddButton={false}
        />
      </div>

      <div style={{ flex: 1 }} />

      <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
        导入
      </Button>
      <Button icon={<ReloadOutlined />} onClick={fetchData}>
        刷新
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新增客户
      </Button>
    </div>
  );
}
