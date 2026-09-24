import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import type { Locale } from 'antd/es/locale';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './i18n';
import i18n from './i18n';
import 'flag-icons/css/flag-icons.min.css';
import './styles/global.css';
import './styles/products.css';

/**
 * 日期面板的「月份 / 星期」文案取自 dayjs locale，而「今天」等按钮文案取自 antd locale。
 * 两者必须同时切换：只切 antd locale 会出现「2026年 Dec」「Su Mo Tu」这类中英混排。
 */
const applyDayjsLocale = (lng: string) => {
  dayjs.locale(lng === 'en' ? 'en' : 'zh-cn');
};

applyDayjsLocale(i18n.language);

function Root() {
  const [antdLocale, setAntdLocale] = useState<Locale>(
    i18n.language === 'en' ? enUS : zhCN
  );

  useEffect(() => {
    const handleLangChange = (lng: string) => {
      setAntdLocale(lng === 'en' ? enUS : zhCN);
      applyDayjsLocale(lng);
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
          borderRadius: 12,
          fontFamily: "'Montserrat', 'SourceHanSansCN', -apple-system, BlinkMacSystemFont, sans-serif",
        },
      }}
    >
      <AntdApp>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
