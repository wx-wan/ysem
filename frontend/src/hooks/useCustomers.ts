import { useMemo } from 'react';
import {
  getAllCustomers,
  getCustomer,
  getCustomerReport,
  getMyCustomers,
  getPublicCustomers,
} from '../api/customers';
import type {
  CustomerAllQuery,
  CustomerAllResponse,
  CustomerDetail,
  CustomerMyQuery,
  CustomerMyResponse,
  CustomerPublicQuery,
  CustomerPublicResponse,
  CustomerReport,
} from '../types/customer';

/**
 * Customer 页面数据入口（Round F-5 §16-§17）
 *
 * 边界与职责：
 *   · 只提供**最小封装**：把 API 函数以稳定引用暴露给页面，不做缓存、不做 React Query；
 *   · Customer 列表属 **page-level transactional data**，**不得**进入 useMasterDataStore
 *     （master data = 低频字典；customer list = 业务数据，随筛选/分页变化）；
 *   · 页面自行管理模式（进入页面请求、筛选/分页变化则重新请求）：
 *       CustomerListPage → useCustomers() → getMyCustomers() / getPublicCustomers() / getAllCustomers()
 *   · 不含任何 owner 候选集逻辑（F-01 冻结）。
 */
export interface CustomerApi {
  getMyCustomers: (params?: CustomerMyQuery) => Promise<CustomerMyResponse>;
  getPublicCustomers: (params?: CustomerPublicQuery) => Promise<CustomerPublicResponse>;
  getAllCustomers: (params?: CustomerAllQuery) => Promise<CustomerAllResponse>;
  getCustomer: (id: string) => Promise<CustomerDetail>;
  getCustomerReport: () => Promise<CustomerReport>;
}

/**
 * 返回稳定的 Customer API 引用（无内部状态、无缓存）。
 *
 * 用法（未来 F-6/F-7 页面）：
 *   const { getMyCustomers } = useCustomers();
 *   useEffect(() => { getMyCustomers({ page, pageSize, keyword }).then(setData); }, [page, pageSize, keyword]);
 */
export function useCustomers(): CustomerApi {
  return useMemo<CustomerApi>(
    () => ({ getMyCustomers, getPublicCustomers, getAllCustomers, getCustomer, getCustomerReport }),
    [],
  );
}

export default useCustomers;
