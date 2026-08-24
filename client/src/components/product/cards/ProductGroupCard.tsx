import React from 'react';
import { Flex, Popconfirm, Button } from 'antd';
import { DeleteOutlined, TeamOutlined } from '@ant-design/icons';
import { ProductGroup } from '../../../api/products';

interface Props {
  group: ProductGroup;
  onOpenManage: (g: ProductGroup) => void;
  onDelete?: (id: string) => void;
  canDelete: boolean;
}

/** 产品组合卡片：沿用产品卡片视觉，点击打开集中管理弹窗。 */
export default function ProductGroupCard({ group, onOpenManage, onDelete, canDelete }: Props) {
  const members = (group.products || []).slice(0, 4);
  const total = group.productCount ?? group.products?.length ?? 0;

  return (
    <div
      className="pm-prod-card pm-group-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpenManage(group)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenManage(group); } }}
    >
      <div className="pm-prod-cover">
        <div className="pm-group-cover">
          <TeamOutlined />
          <span className="pm-group-cover__count">{total}</span>
          <small>件产品</small>
        </div>
      </div>

      <div className="pm-prod-body">
        <Flex className="pm-prod-title-row" align="center" justify="space-between" gap={8}>
          <div className="pm-prod-name" title={group.name} style={{ flex: '1 1 auto', minWidth: 0 }}>{group.name}</div>
          <span className="pm-group-badge">组合</span>
        </Flex>
        <div className="pm-group-desc" title={group.description || undefined}>{group.description || '暂无备注'}</div>
        <div className="pm-prod-tags">
          {members.map((p) => (
            <span key={p.id} className="pm-prod-tag pm-prod-tag--ghost">{p.name}</span>
          ))}
          {total > 4 && <span className="pm-prod-tag pm-prod-tag--ghost">+{total - 4}</span>}
        </div>
      </div>

      <div className="pm-prod-foot">
        <span className="pm-prod-sku">组 · {group.id.slice(0, 8)}</span>
        <span className="pm-actions" onClick={(e) => e.stopPropagation()}>
          {canDelete && onDelete ? (
            <Popconfirm title="确定删除该产品组？" onConfirm={() => onDelete(group.id)}>
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ) : null}
        </span>
      </div>
    </div>
  );
}
