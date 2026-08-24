import axios from './request';

export interface SalesItem {
  id: string;
  pipelineNumber: string;
  stage: string;
  title: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  country?: string;
  source?: string;
  productInterest?: string;
  leadNotes?: string;
  estimatedAmount?: number;
  estimatedCloseDate?: string;
  probability?: string;
  opportunityNotes?: string;
  sampleType?: string;
  sampleQuantity?: number;
  sampleStatus?: string;
  sampleNotes?: string;
  orderAmount?: number;
  orderDate?: string;
  deliveryDate?: string;
  paymentTerms?: string;
  orderStatus?: string;
  orderType?: string;   // SAMPLE / FORMAL
  orderNotes?: string;
  assignedTo?: string;
  assignee?: { id: string; realName: string; username: string } | null;
  activities?: SalesActivity[];
  leadProducts?: LeadProduct[];
  createdAt: string;
  updatedAt: string;
  // 按产品聚合时后端附加字段
  status?: string;
  updateTime?: string;
  quantity?: number;
}

/** 销售阶段（线索/商机/订单）中文与配色 */
export const STAGE_META: Record<string, { label: string; color: string }> = {
  LEAD: { label: '线索', color: '#1677ff' },
  OPPORTUNITY: { label: '商机', color: '#d97706' },
  ORDER: { label: '订单', color: '#16a34a' },
};

export interface LeadProduct {
  id: string;
  leadId: string;
  productId: string;
  quantity: number;
  product?: {
    id: string;
    name: string;
    sku?: string | null;
    type: 'SELF' | 'EXTERNAL';
    selfKind?: 'FINISHED' | 'SEMI' | null;
  };
}

export interface SalesActivity {
  id: string;
  pipelineId: string;
  action: string;
  fromStage?: string;
  toStage?: string;
  comment?: string;
  createdBy: string;
  createdAt: string;
}

export const salesApi = {
  // 列表
  list: (params: Record<string, string>, signal?: AbortSignal) =>
    axios.get<{ data: { list: SalesItem[]; total: number; page: number; pageSize: number } }>('/sales', { params, signal }),

  // 看板
  kanban: (signal?: AbortSignal) =>
    axios.get<{ data: { columns: Record<string, { title: string; items: SalesItem[] }>; stats: Record<string, number> } }>('/sales/kanban', { signal }),

  // 详情
  get: (id: string) =>
    axios.get<{ data: SalesItem }>(`/sales/${id}`),

  // 创建
  create: (data: Partial<SalesItem>) =>
    axios.post<{ data: SalesItem }>('/sales', data),

  // 更新
  update: (id: string, data: Partial<SalesItem>) =>
    axios.put<{ data: SalesItem }>(`/sales/${id}`, data),

  // 阶段变更
  changeStage: (id: string, stage: string) =>
    axios.patch<{ data: SalesItem }>(`/sales/${id}/stage`, { stage }),

  // 删除
  delete: (id: string) =>
    axios.delete(`/sales/${id}`),

  // 批量删除
  batchDelete: (ids: string[]) =>
    axios.delete('/sales/batch', { data: { ids } }),

  // 导入 Excel
  importExcel: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return axios.post('/sales/import', form);
  },

  // 获取可分配用户
  getAssignUsers: () =>
    axios.get<{ data: { id: string; realName: string; username: string }[] }>('/sales/assign-users'),

  // 按客户查询商机记录
  listByCustomer: (customerId: string) =>
    axios.get<{ data: SalesItem[] }>(`/sales/by-customer/${customerId}`),

  // 按产品查询商机记录
  listByProduct: (productId: string) =>
    axios.get<{ data: { list: SalesItem[]; total: number } }>(`/sales/by-product/${productId}`),
};
