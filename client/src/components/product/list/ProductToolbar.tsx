import { Row, Col, Input, Select, Button, Space } from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import ViewModeSwitch from '../../common/ViewModeSwitch';
import type { ViewMode } from '../../common/ViewModeSwitch';

interface Option { value: string; label: string }

interface ProductToolbarProps {
  searchInput: string;
  setSearchInput: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  audienceFilter: string;
  setAudienceFilter: (v: string) => void;
  craftFilter: string;
  setCraftFilter: (v: string) => void;
  supplierFilter: string;
  setSupplierFilter: (v: string) => void;
  categories: Option[];
  audiences: Option[];
  crafts: Option[];
  suppliers: Option[];
  statusOptions: Option[];
  onSearch: () => void;
  onReset: () => void;
  onCreate: () => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}

export default function ProductToolbar({
  searchInput, setSearchInput, statusFilter, setStatusFilter,
  categoryFilter, setCategoryFilter, audienceFilter, setAudienceFilter,
  craftFilter, setCraftFilter, supplierFilter, setSupplierFilter,
  categories, audiences, crafts, suppliers, statusOptions,
  onSearch, onReset, onCreate, viewMode, setViewMode,
}: ProductToolbarProps) {
  return (
    <div className="pm-toolbar">
      <Row gutter={[12, 12]} align="middle">
        <Col xs={24} sm={12} md={8} lg={6}>
          <Input
            allowClear
            placeholder="搜索 SKU / 名称"
            prefix={<SearchOutlined />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={onSearch}
          />
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Select
            allowClear
            placeholder="状态"
            style={{ width: '100%' }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            options={statusOptions}
          />
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Select
            allowClear
            placeholder="分类"
            style={{ width: '100%' }}
            value={categoryFilter || undefined}
            onChange={(v) => setCategoryFilter(v || '')}
            options={categories}
          />
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Select
            allowClear
            placeholder="工艺"
            style={{ width: '100%' }}
            value={craftFilter || undefined}
            onChange={(v) => setCraftFilter(v || '')}
            options={crafts}
          />
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Select
            allowClear
            placeholder="供应模式"
            style={{ width: '100%' }}
            value={audienceFilter || undefined}
            onChange={(v) => setAudienceFilter(v || '')}
            options={audiences}
          />
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Select
            allowClear
            placeholder="供应商"
            style={{ width: '100%' }}
            value={supplierFilter || undefined}
            onChange={(v) => setSupplierFilter(v || '')}
            options={suppliers}
          />
        </Col>
        <Col flex="none">
          <Space>
            <Button onClick={onReset} icon={<ReloadOutlined />}>重置</Button>
            <Button type="primary" onClick={onSearch}>搜索</Button>
          </Space>
        </Col>
        <Col flex="auto" />
        <Col>
          <Space>
            <ViewModeSwitch value={viewMode} onChange={setViewMode} />
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新建产品</Button>
          </Space>
        </Col>
      </Row>
    </div>
  );
}
