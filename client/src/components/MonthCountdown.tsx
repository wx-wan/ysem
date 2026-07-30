import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export default function MonthCountdown() {
  const { t } = useTranslation();
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      // 下月第一天 00:00:00
      const nextMonth = new Date(year, month + 1, 1, 0, 0, 0);
      const diff = nextMonth.getTime() - now.getTime();

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    };

    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, []);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="month-countdown">
      <div className="countdown-label">{t('dashboard.monthEndCountdown')}</div>
      <div className="countdown-digits">
        <div className="countdown-block">
          <span className="countdown-num">{pad(timeLeft.days)}</span>
          <span className="countdown-unit">{t('dashboard.days')}</span>
        </div>
        <span className="countdown-sep">:</span>
        <div className="countdown-block">
          <span className="countdown-num">{pad(timeLeft.hours)}</span>
          <span className="countdown-unit">{t('dashboard.hours')}</span>
        </div>
        <span className="countdown-sep">:</span>
        <div className="countdown-block">
          <span className="countdown-num">{pad(timeLeft.minutes)}</span>
          <span className="countdown-unit">{t('dashboard.minutes')}</span>
        </div>
        <span className="countdown-sep">:</span>
        <div className="countdown-block">
          <span className="countdown-num">{pad(timeLeft.seconds)}</span>
          <span className="countdown-unit">{t('dashboard.seconds')}</span>
        </div>
      </div>
    </div>
  );
}
