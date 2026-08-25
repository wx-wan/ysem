import request from '../utils/request';

export interface ApprovalConfigDTO {
  type: 'QUOTE' | 'SAMPLE' | 'ORDER';
  approverIds?: string[];
  approverNames?: string[];
  enabled?: boolean;
}

export const approvalApi = {
  list: () => request.get<any>('/approvals'),
  save: (data: ApprovalConfigDTO) => request.post<any>('/approvals', data),
  remove: (type: string) => request.delete<any>(`/approvals/${type}`),
};
