import { Button, Input, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useMasterData } from '../../hooks/useMasterData';
import type { CustomerListType } from '../../types/customer';
import { TYPE_FILTER_OPTIONS, TYPE_FILTER_SCOPE_NOTE } from './constants';

export interface CustomerFilterBarProps {
  keyword: string;
  country: string | undefined;
  type: CustomerListType | undefined;
  /** 当前视图是否支持 type 筛选（/public 不支持） */
  showType: boolean;
  onKeywordSubmit: (keyword: string) => void;
  onCountryChange: (country: string | undefined) => void;
  onTypeChange: (type: CustomerListType | undefined) => void;
}

/**
 * 筛选栏（Round F-6 §12-§16）
 *
 * 规则：
 *   · 关键词使用「点击搜索 / Enter」触发（不逐字请求）；country / type 变化立即请求；
 *   · country 选项来自 F-4 `useMasterData().countries`（可能为空 ⇒ 正常展示空下拉，**不造假数据**）；
 *   · type 选项来自本页常量（值 = 后端真实分支），中文 label 由 UI 层提供。
 *
 * 边界：**不提供负责人（ownerId）筛选** —— F-01 已冻结 owner 候选源，本轮不调用任何选人接口。
 */
export default function CustomerFilterBar({
  keyword,
  country,
  type,
  showType,
  onKeywordSubmit,
  onCountryChange,
  onTypeChange,
}: CustomerFilterBarProps) {
  const { countries, loadCountries } = useMasterData();
  const [keywordInput, setKeywordInput] = useState(keyword);

  // 外部（URL / 视图切换）改变 keyword 时同步输入框
  useEffect(() => setKeywordInput(keyword), [keyword]);

  // 进入页面时确保国家字典就绪（TTL 缓存内不会重复请求）
  useEffect(() => {
    void loadCountries().catch(() => {
      /* 字典失败不阻塞列表：Select 保持空态 */
    });
  }, [loadCountries]);

  const countryOptions = countries.map((c) => ({ label: c, value: c }));

  return (
    <Space size={12} wrap>
      <Input
        allowClear
        style={{ width: 220 }}
        placeholder="公司名称 / 联系人"
        value={keywordInput}
        onChange={(e) => setKeywordInput(e.target.value)}
        onPressEnter={() => onKeywordSubmit(keywordInput.trim())}
      />
      <Button onClick={() => onKeywordSubmit(keywordInput.trim())}>搜索</Button>

      <Select
        allowClear
        style={{ width: 180 }}
        placeholder="国家/地区"
        value={country}
        options={countryOptions}
        onChange={(value?: string) => onCountryChange(value)}
      />

      {showType ? (
        <>
          <Select
            allowClear
            style={{ width: 200 }}
            placeholder="类型"
            value={type}
            options={TYPE_FILTER_OPTIONS}
            onChange={(value?: CustomerListType) => onTypeChange(value)}
          />
          {/* IC-FE-3 + IC-FE-6：类型筛选取自商机意向/订单记录，且与统计卡片口径不同 */}
          <Typography.Text type="secondary">{TYPE_FILTER_SCOPE_NOTE}</Typography.Text>
        </>
      ) : null}
    </Space>
  );
}
