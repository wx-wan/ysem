import axios from './request';

export type LeadSource = 'MANUAL' | 'EXCEL' | 'RPA' | 'SYNC';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'INVALID' | 'CONVERTED';

export interface LeadCustomer {
  id: string;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
}

export interface LeadChannel {
  id: string;
  name: string;
  category?: string;
}

export interface Lead {
  id: string;
  leadName: string;
  customerId?: string | null;
  customer?: LeadCustomer | null;
  channelId?: string | null;
  channel?: LeadChannel | null;
  shopId?: string | null;
  shop?: LeadChannel | null;
  source: LeadSource;
  status: LeadStatus;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  productInterest?: string | null;
  remark?: string | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadPayload {
  leadName: string;
  customerId?: string | null;
  channelId?: string | null;
  shopId?: string | null;
  source?: LeadSource;
  status?: LeadStatus;
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  country?: string;
  productInterest?: string;
  remark?: string;
  assignedTo?: string | null;
}

export interface LeadListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channelId?: string;
  shopId?: string;
  status?: LeadStatus;
  source?: LeadSource;
  assignedTo?: string;
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
};
