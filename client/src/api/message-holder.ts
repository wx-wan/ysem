// 存储 App.useApp() 返回的 message 实例，避免静态调用冲突
import { message as antMessage } from 'antd';

let holder: typeof antMessage | null = null;

export function setMessageHolder(api: typeof antMessage) {
  holder = api;
}

export function getMessage(): typeof antMessage {
  return holder || antMessage;
}
