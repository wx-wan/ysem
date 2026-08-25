import { useEffect, useState } from 'react';
import { Segmented } from 'antd';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Products from './Products';
import ProductTaxonomy from './ProductTaxonomy';
import CertificatePage from './Certificate';

type Tab = 'product' | 'taxonomy' | 'certificate';

export default function ProductManagement() {
  const { t } = useTranslation();
  const location = useLocation();

  const init: Tab = location.pathname.startsWith('/system/certificates')
    ? 'certificate'
    : location.pathname.startsWith('/system/product-taxonomy')
    ? 'taxonomy'
    : 'product';

  const [tab, setTab] = useState<Tab>(init);

  // 当通过侧边栏路由进入时，按路径同步默认 Tab
  useEffect(() => {
    setTab(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const TABS = [
    { label: t('menu.products') || '产品', value: 'product' },
    { label: t('menu.systemProductTaxonomy') || '产品分类', value: 'taxonomy' },
    { label: t('menu.systemCertificates') || '证书', value: 'certificate' },
  ];

  return (
    <div className="product-management">
      <Segmented className="um-tab-switch" options={TABS} value={tab} onChange={(v) => setTab(v as Tab)} />
      <div style={{ marginTop: 16 }}>
        {tab === 'product' && <Products />}
        {tab === 'taxonomy' && <ProductTaxonomy />}
        {tab === 'certificate' && <CertificatePage />}
      </div>
    </div>
  );
}
