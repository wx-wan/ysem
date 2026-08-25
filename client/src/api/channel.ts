import axios from './request';

export interface Channel {
  id: string;
  name: string;
  category: 'ONLINE' | 'OFFLINE'; // 线上平台 / 线下展会
  parentId: string | null;
  parent?: Channel | null;
  children?: Channel[];
  contact?: string | null;
  status: 'ENABLED' | 'DISABLED';
  sort: number;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelPayload {
  name: string;
  category?: 'ONLINE' | 'OFFLINE';
  parentId?: string | null;
  contact?: string;
  status?: 'ENABLED' | 'DISABLED';
  sort?: number;
  remark?: string;
}

export const channelApi = {
  list: () => axios.get<{ code: number; data: Channel[] }>('/channels').then((r) => r.data),
  tree: () => axios.get<{ code: number; data: Channel[] }>('/channels/tree').then((r) => r.data),
  get: (id: string) => axios.get<{ code: number; data: Channel }>(`/channels/${id}`).then((r) => r.data),
  create: (payload: ChannelPayload) =>
    axios.post<{ code: number; data: Channel }>('/channels', payload).then((r) => r.data),
  update: (id: string, payload: Partial<ChannelPayload>) =>
    axios.put<{ code: number; data: null }>(`/channels/${id}`, payload).then((r) => r.data),
  delete: (id: string) =>
    axios.delete<{ code: number; data: null }>(`/channels/${id}`).then((r) => r.data),
};
