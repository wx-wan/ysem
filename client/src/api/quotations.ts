import request from './request';

export interface Quotation {
  id: string;
  opportunityId: string;
  customerId?: string | null;
  productId?: string | null;
  title: string;
  version: number;
  amount: number;
  currency: string;
  validUntil?: string | null;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
  notes?: string | null;
  customer?: { id: string; companyName: string } | null;
  product?: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuotationListRes {
  list: Quotation[];
  total: number;
  page: number;
  pageSize: number;
}

export const quotationApi = {
  list: (params: { opportunityId?: string; customerId?: string; status?: string; page?: number; pageSize?: number }) =>
    request.get<QuotationListRes>('/quotations', { params }),
  get: (id: string) => request.get<Quotation>(`/quotations/${id}`),
  create: (data: Partial<Quotation>) => request.post<Quotation>('/quotations', data),
  update: (id: string, data: Partial<Quotation>) => request.put<Quotation>(`/quotations/${id}`, data),
  remove: (id: string) => request.delete(`/quotations/${id}`),
};

export default quotationApi;
