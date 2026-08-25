import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Products from './Products';
import ProductTaxonomy from './ProductTaxonomy';
import CertificatePage from './Certificate';
import SegmentedTabBar from '../components/common/SegmentedTabBar';

type Tab = 'product' | 'taxonomy' | 'certificate';

export default function ProductManagement({ systemOnly = false }: { systemOnly?: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();

  const init: Tab = location.pathname.startsWith('/system/certificates')
    ? 'certificate'
    : location.pathname.startsWith('/system/product-taxonomy')
    ? 'taxonomy'
    : systemOnly
    ? 'taxonomy'
    : 'product';

  const [tab, setTab] = useState<Tab>(init);

  // 当通过侧边栏路由进入时，按路径同步默认 Tab
  useEffect(() => {
    setTab(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const TABS = systemOnly
    ? [
        { label: t('menu.systemProductTaxonomy') || '产品管理', key: 'taxonomy' },
        { label: t('menu.systemCertificateManage') || '证书管理', key: 'certificate' },
      ]
    : [{ label: t('menu.products') || '产品', key: 'product' }];

  return (
    <div className="product-management">
      {systemOnly && (
        <SegmentedTabBar options={TABS} value={tab} onChange={(v) => setTab(v as Tab)} />
      )}
      <div style={{ marginTop: 16 }}>
        {systemOnly ? (
          <>
            {tab === 'taxonomy' && <ProductTaxonomy />}
            {tab === 'certificate' && <CertificatePage />}
          </>
        ) : (
          <Products />
        )}
      </div>
    </div>
  );
}
