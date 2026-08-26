import { useCallback, useEffect, useState } from 'react';
import { channelApi, type Channel } from '../../api/channel';
import { customerApi, type Customer } from '../../api/customers';
import { productApi, taxonomyApi, type ProductAudience, type ProductCraft, type ProductOption } from '../../api/products';

export interface CustomerOption {
  label: string;
  value: string;
  contactName?: string;
  customerCode?: string;
}

/** 线索表单依赖的选项数据：渠道树 / 产品 / 工艺与受众分类 / 客户 */
export function useLeadOptions() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await channelApi.tree();
      setChannels(res.data);
    } catch {
      /* 渠道树加载失败可忽略，重试窗口内为空 */
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await productApi.options();
      setProductOptions(res.data.data || []);
    } catch {
      /* 产品选项加载失败可忽略 */
    }
  }, []);

  const fetchTaxonomy = useCallback(async () => {
    try {
      const [cRes, aRes] = await Promise.all([taxonomyApi.getCrafts(), taxonomyApi.getAudiences()]);
      if (cRes.data.code === 200 || cRes.data.code === 0) setCrafts(cRes.data.data);
      if (aRes.data.code === 200 || aRes.data.code === 0) setAudiences(aRes.data.data);
    } catch {
      /* 分类加载失败可忽略 */
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await customerApi.options();
      setCustomerOptions(
        (res.data.data || []).map((c: Customer) => ({
          label: c.companyName,
          value: c.id,
          contactName: c.contactName || undefined,
          customerCode: c.customerCode || undefined,
        })),
      );
    } catch {
      /* 客户选项加载失败可忽略 */
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchProducts();
    fetchTaxonomy();
  }, [fetchChannels, fetchProducts, fetchTaxonomy]);

  return { channels, productOptions, crafts, audiences, customerOptions, fetchCustomers, fetchProducts };
}
