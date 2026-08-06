import type { TablePaginationConfig } from 'antd';

/**
 * 统一列表分页配置 —— 全局唯一真源。
 * 风格对齐客户管理页：无「条/页」下拉（showSizeChanger=false）、保留「跳至」输入框、显示总数。
 */
export function buildTablePagination(params: {
  total: number;
  page: number;
  pageSize: number;
  onChange: (page: number, pageSize: number) => void;
  showSizeChanger?: boolean;
}): TablePaginationConfig {
  const { total, page, pageSize, onChange, showSizeChanger = false } = params;
  return {
    current: page,
    pageSize,
    total,
    showSizeChanger,
    showQuickJumper: true,
    showTotal: (t) => `共 ${t} 条`,
    onChange,
  };
}
