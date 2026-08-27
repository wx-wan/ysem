import axios from './request';
import type { ProductImageItem } from '../utils/productImages';

export type LeadSource = 'MANUAL' | 'EXCEL' | 'RPA' | 'SYNC';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'INVALID' | 'CONVERTED' | 'VALID';
export type LeadUrgency = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LeadCustomer {
  id: string;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
}

export interface Lead {
  id: string;
  leadName: string;
  customerId?: string | null;
  customer?: LeadCustomer | null;
  sourceChannel?: string | null;
  source: LeadSource;
  status: LeadStatus;
  companyName?: string | null;
  contactName?: string | null;
  contactMethod?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  productInterest?: string | null;
  productName?: string | null;
  productId?: string | null;
  product?: { id: string; name: string } | null;
  quantity?: number;
  remark?: string | null;
  // 详情扩展字段
  targetMarket?: string | null;
  productType?: string | null;
  productDesc?: string | null;
  images?: string[] | string | null;
  targetPrice?: string | null;
  certRequire?: string | null;
  packageReq?: string | null;
  deliveryReq?: string | null;
  specialReq?: string | null;
  customerType?: string | null;
  urgency?: LeadUrgency | null;
  assignedTo?: string | null;
  assignedUser?: { id: string; username: string; realName: string | null } | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  pipelineId?: string | null; // 关联商机 ID（确认转商机后回填，便于溯源）
}

export interface LeadPayload {
  leadName?: string;
  customerId?: string | null;
  sourceChannel?: string | null;
  productId?: string | null;
  quantity?: number;
  source?: LeadSource;
  status?: LeadStatus;
  companyName?: string | null;
  contactName?: string | null;
  contactMethod?: string | null;
  email?: string;
  phone?: string;
  country?: string;
  productInterest?: string;
  productName?: string | null;
  remark?: string;
  // 详情扩展字段
  targetMarket?: string | null;
  productType?: string | null;
  productDesc?: string | null;
  images?: string[] | string | null;
  targetPrice?: string | null;
  certRequire?: string | null;
  packageReq?: string | null;
  deliveryReq?: string | null;
  specialReq?: string | null;
  customerType?: string | null;
  urgency?: LeadUrgency | null;
  assignedTo?: string | null;
}

export interface LeadListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channel?: string;
  platform?: string;
  status?: LeadStatus;
  source?: LeadSource;
  assignedTo?: string;
  scope?: 'mine' | 'pool';
}

export const leadApi = {
  list: (params: LeadListParams = {}) =>
    axios
      .get<{ code: number; data: { list: Lead[]; total: number; page: number; pageSize: number } }>('/leads', {
        params,
      })
      .then((r) => r.data),
  get: (id: string) => axios.get<{ code: number; data: Lead }>(`/leads/${id}`).then((r) => r.data),
  create: (payload: LeadPayload) =>
    axios.post<{ code: number; data: Lead }>('/leads', payload).then((r) => r.data),
  update: (id: string, payload: Partial<LeadPayload>) =>
    axios.put<{ code: number; data: null }>(`/leads/${id}`, payload).then((r) => r.data),
  delete: (id: string) => axios.delete<{ code: number; data: null }>(`/leads/${id}`).then((r) => r.data),
  changeStatus: (id: string, status: LeadStatus) =>
    axios.patch<{ code: number; data: null }>(`/leads/${id}/status`, { status }).then((r) => r.data),
  transfer: (id: string, newOwnerId: string) =>
    axios.post<{ code: number; data: null }>(`/leads/${id}/transfer`, { newOwnerId }).then((r) => r.data),
  release: (id: string) =>
    axios.post<{ code: number; data: null }>(`/leads/${id}/release`).then((r) => r.data),
};
