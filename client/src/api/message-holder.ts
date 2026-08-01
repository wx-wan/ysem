// 存储 App.useApp() 返回的 message 实例，避免静态调用冲突
import { message as antMessage } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

let holder: MessageInstance | null = null;

export function setMessageHolder(api: MessageInstance) {
  holder = api;
}

export function getMessage(): MessageInstance {
  return holder || (antMessage as unknown as MessageInstance);
}
