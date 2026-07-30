import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import type { Locale } from 'antd/es/locale';
import App from './App';
import './i18n';
import i18n from './i18n';
import './styles/global.css';

function Root() {
  const [antdLocale, setAntdLocale] = useState<Locale>(
    i18n.language === 'en' ? enUS : zhCN
  );

  useEffect(() => {
    const handleLangChange = (lng: string) => {
      setAntdLocale(lng === 'en' ? enUS : zhCN);
      localStorage.setItem('lang', lng);
    };
    i18n.on('languageChanged', handleLangChange);
    return () => {
      i18n.off('languageChanged', handleLangChange);
    };
  }, []);

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
