import { Card, Avatar, Tag } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import KeyAccountStar from '../KeyAccountStar';
import FlagIcon from '../FlagIcon';
import type { Customer } from '../../api/customers';
import { getGrade, tagColorToHex } from './utils';
import { findCountry } from '../../data/countries';

// 解析单个标签字符串
function parseTag(tagStr: string): { name: string; color?: string } {
  const idx = tagStr.lastIndexOf('#');
  if (idx > 0) {
    return { name: tagStr.slice(0, idx), color: tagStr.slice(idx + 1) };
  }
  return { name: tagStr };
}

const SYSTEM_TAGS = ['重点客户', '未成交客户', '本年度新客', '往年老客'];

function filterCustomTags(tags?: string): { name: string; color?: string }[] {
  if (!tags) return [];
  return tags.split(',').filter(Boolean).map(parseTag).filter((t) => !SYSTEM_TAGS.includes(t.name));
}

interface CustomerCardProps {
  customer: Customer;
  token: any;
  formatCurrency: (value: number) => string;
  onOpenDetail: (customer: Customer) => void;
  onListUpdate: (updater: (prev: Customer[]) => Customer[]) => void;
}

export default function CustomerCard({
  customer,
  token,
  formatCurrency,
  onOpenDetail,
  onListUpdate,
}: CustomerCardProps) {
  const grade = getGrade(customer);
  const isPublic = !customer.ownerId || customer.owner?.role?.code === 'admin';
  const ownerName = isPublic ? '公海' : (customer.owner?.realName || customer.owner?.username || '');
  const firstChar = isPublic
    ? '公'
    : (ownerName?.charAt(0) || customer.contactName?.charAt(0) || customer.companyName?.charAt(0) || '?');
  const headerColor = tagColorToHex(grade.tagColor, token);

  const getTypeLabel = () => {
    const currentYear = new Date().getFullYear().toString();
    if (customer.firstOrderDate) {
      if (customer.firstOrderDate.startsWith(currentYear)) return '本年度新客';
      return '往年老客';
    }
    return '未成交客户';
  };

  return (
    <div style={{ height: '100%' }}>
      <Card
        hoverable
        onClick={() => onOpenDetail(customer)}
        style={{
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          cursor: 'pointer',
          height: '100%',
          overflow: 'hidden',
        }}
        styles={{ body: { padding: 0 } }}
      >
        {/* 彩色头部区域 */}
        <div
          style={{
            background: `linear-gradient(135deg, ${headerColor} 0%, ${headerColor}dd 100%)`,
            padding: '20px 20px 18px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{
            position: 'absolute', top: -36, right: -24,
            width: 120, height: 120, borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.08)',
          }} />
          <div style={{
            position: 'absolute', bottom: -48, right: 60,
            width: 88, height: 88, borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.04)',
          }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
            <span style={{
              backgroundColor: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(4px)',
              color: token.colorWhite,
              fontSize: 11, fontWeight: 600,
              padding: '3px 10px',
              borderRadius: token.borderRadiusSM,
              lineHeight: '18px',
              letterSpacing: '0.3px',
            }}>
              {getTypeLabel()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <KeyAccountStar
                isKeyAccount={customer.isKeyAccount || false}
                customerId={customer.id}
                color="rgba(255,255,255,0.9)"
                mutedColor="rgba(255,255,255,0.35)"
                onToggle={() => {
                  onListUpdate((prev) =>
                    prev.map((c) =>
                      c.id === customer.id ? { ...c, isKeyAccount: !c.isKeyAccount } : c
                    )
                  );
                }}
              />
              <FlagIcon country={customer.country} style={{ borderRadius: 2 }} />
            </div>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: token.colorWhite, marginTop: 14, lineHeight: 1.3, position: 'relative', zIndex: 1 }}>
            {customer.companyName || '-'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 6, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <GlobalOutlined style={{ fontSize: 11 }} />
            {findCountry(customer.country)?.zh || (customer.country || '未知')}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 1 auto', minWidth: 0 }}>
            <Avatar size={40} style={{ backgroundColor: headerColor, fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
              {firstChar}
            </Avatar>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: token.colorTextHeading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {customer.contactName || '-'}
              </div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {customer.email || '-'}
              </div>
              {customer.phone ? (
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{customer.phone}</div>
              ) : (
                <div style={{ fontSize: 12, color: token.colorTextQuaternary }}>暂无联系方式</div>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right', flex: '0 0 auto', margin: '0 12px' }}>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>预计商机金额</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>
              {formatCurrency(customer.pipelineAmount || 0)}
            </div>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>{customer._count?.pipelines ?? 0} 商机</div>
          </div>

          <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>成交订单金额</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>
              {formatCurrency(customer.totalAmount || 0)}
            </div>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>{customer._count?.orders ?? 0} 单</div>
          </div>
        </div>

        {/* 底部分隔线 + 标签 */}
        <div style={{ borderTop: `1px dashed ${token.colorBorderSecondary}`, padding: '10px 20px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0, alignItems: 'center' }}>
            {filterCustomTags(customer.tags).map((tag) => {
              const c = tagColorToHex(tag.color, token);
              return (
                <Tag key={tag.name} bordered={false} style={{
                  margin: 0, borderRadius: token.borderRadiusSM, fontSize: 11,
                  padding: '1px 8px', backgroundColor: token.colorBgContainer,
                  color: c, border: `1px solid ${c}`,
                }}>{tag.name}</Tag>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: token.colorTextQuaternary, whiteSpace: 'nowrap', marginLeft: 8 }}>
            {dayjs(customer.createdAt).format('YYYY-MM-DD')}
          </div>
        </div>
      </Card>
    </div>
  );
}
