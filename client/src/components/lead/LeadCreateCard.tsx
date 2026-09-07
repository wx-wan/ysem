import { useTranslation } from 'react-i18next';
import CreateEntryCard from '../common/CreateEntryCard';

interface Props {
  onClick: () => void;
}

/** 新建线索入口卡片（与参考图一致：浅蓝底色 + 蓝色虚线边框 + 左侧加号） */
export default function LeadCreateCard({ onClick }: Props) {
  const { t } = useTranslation();

  return (
    <CreateEntryCard
      onClick={onClick}
      title={t('lead.createTitle')}
      description={t('lead.createDesc')}
    />
  );
}
