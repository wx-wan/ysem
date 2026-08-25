import request, { type ApiResponse } from './request';

export interface ApprovalConfigDTO {
  type: 'QUOTE' | 'SAMPLE' | 'ORDER';
  approverIds?: string[];
  approverNames?: string[];
  enabled?: boolean;
}

export interface ApprovalConfigItem {
  type: 'QUOTE' | 'SAMPLE' | 'ORDER';
  approverIds: string;
  approverNames: string;
  enabled: boolean;
}

export const approvalApi = {
  list: () => request.get<ApiResponse<ApprovalConfigItem[]>>('/approvals'),
  save: (data: ApprovalConfigDTO) => request.post<ApiResponse<any>>('/approvals', data),
  remove: (type: string) => request.delete<ApiResponse<any>>(`/approvals/${type}`),
};
