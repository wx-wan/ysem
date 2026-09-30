import { useCallback, useEffect, useState } from 'react';
import { channelApi, type Channel } from '../api/channel';

/**
 * 渠道树（来源渠道选项的唯一数据源）。
 *
 * 线索表单、客户详情 / 编辑共用：避免各处各拉一次导致下拉/回显口径不一。
 */
export function useChannelTree() {
  const [channels, setChannels] = useState<Channel[]>([]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await channelApi.tree();
      setChannels(res.data || []);
    } catch {
      /* 渠道树加载失败可忽略（选项为空即可，不阻断表单） */
    }
  }, []);

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  return { channels, fetchChannels };
}

export default useChannelTree;
