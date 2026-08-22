import { memo } from 'react';
import { Skeleton, Popconfirm, Button, Flex } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Product } from '../../../api/products';
import { mainImageUrl } from '../../../utils/productImages';

interface ProductCardProps {
  product: Product;
  /** 点击卡片打开详情 */
  onOpenDetail?: (p: Product) => void;
  /** 删除回调（传入后卡片显示删除图标） */
  onDelete?: (id: string) => void;
  /** 是否可删除 */
  canDelete?: boolean;
}

export const ProductCardSkeleton = memo(function ProductCardSkeleton() {
  return (
    <div className="pm-prod-card pm-prod-card--skeleton">
      <div className="pm-prod-cover">
        <div className="pm-prod-skeleton-head">
          <Skeleton.Avatar active shape="round" size={20} />
          <Skeleton.Avatar active shape="round" size={20} />
        </div>
      </div>
      <div className="pm-prod-body">
        <Skeleton.Input active size="small" style={{ width: '60%' }} />
        <Skeleton.Input active size="small" style={{ width: '80%' }} />
        <div className="pm-prod-meta">
          {[0, 1, 2].map((k) => (
            <div key={k} className="pm-prod-meta__item">
              <Skeleton.Input active size="small" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
        <div className="pm-prod-foot">
          <Skeleton.Input active size="small" style={{ width: '40%' }} />
          <Skeleton.Avatar active shape="circle" size={22} />
        </div>
      </div>
    </div>
  );
});

const ProductCard = memo(function ProductCard({
  product,
  onOpenDetail,
  onDelete,
  canDelete,
}: ProductCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className="pm-prod-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail?.(product)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail?.(product); } }}
    >
      {/* 左侧：正方形主图 */}
      <div className="pm-prod-cover">
        {mainImageUrl(product.images) ? (
          <img src={mainImageUrl(product.images)} alt="" />
        ) : null}
      </div>

      {/* 右侧：产品信息 */}
      <div className="pm-prod-body">
        <Flex className="pm-prod-title-row" align="center" justify="space-between" gap={8}>
          <div className="pm-prod-name" title={product.name} style={{ flex: '1 1 auto', minWidth: 0 }}>{product.name}</div>
          {/* 右上角：公开状态，与名称水平居中对齐 */}
          <div className="pm-prod-topbar">
            <span className={`pm-status pm-prod-status ${product.visibility === 'PRIVATE' ? 'pm-status--inactive' : 'pm-status--active'}`}>
              {product.visibility === 'PRIVATE' ? t('product.visibilityPrivate') : t('product.visibilityPublic')}
            </span>
          </div>
        </Flex>
        <div className="pm-prod-tags">
          {product.crafts?.length
            ? product.crafts.map((c) => <span key={c.id} className="pm-prod-tag">{c.name}</span>)
            : null}
          {product.audience ? <span className="pm-prod-tag pm-prod-tag--ghost">{product.audience.name}</span> : null}
        </div>

        {product.category ? (
          <div className="pm-prod-category-row">
            <span className="pm-prod-tag pm-prod-tag--ghost">{product.category.name}</span>
          </div>
        ) : null}

        <div className="pm-prod-meta">
          <div className="pm-prod-meta__item">
            <span className="pm-prod-meta__label">尺寸</span>
            <span className="pm-prod-meta__value">
              {[product.sizeL, product.sizeW, product.sizeH].filter(Boolean).join('×') || '-'}
              {([product.sizeL, product.sizeW, product.sizeH].filter(Boolean).length ? ' cm' : '')}
            </span>
          </div>
          <div className="pm-prod-meta__item">
            <span className="pm-prod-meta__label">克重</span>
            <span className="pm-prod-meta__value">
              {product.weight || '-'}{product.weight ? ' g' : ''}
            </span>
          </div>
          <div className="pm-prod-meta__item">
            <span className="pm-prod-meta__label">单位</span>
            <span className="pm-prod-meta__value">
              {product.unit === '套' ? '组合' : '单品'}
            </span>
          </div>
        </div>

        <div className="pm-prod-foot">
          <span className="pm-prod-sku">{product.sku || 'SKU —'}</span>
          <span className="pm-actions" onClick={(e) => e.stopPropagation()}>
            {canDelete && onDelete ? (
              <Popconfirm title="确定删除？" onConfirm={() => onDelete(product.id)}>
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
});

export default ProductCard;
