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
}

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
    unit?: string | null;
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
};
