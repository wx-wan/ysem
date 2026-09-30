import request from '../api/request';

/** 从 Content-Disposition 解析文件名（后端未给出或不可解析时回退 fallback） */
const filenameFrom = (disposition: unknown, fallback: string): string => {
  const m = typeof disposition === 'string' ? disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) : null;
  if (!m) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return fallback;
  }
};

/**
 * 带鉴权的文件下载（导入模板 / 导出报表等受保护资源）。
 *
 * 不能使用 `window.open(url)`：新标签页请求不会携带 `Authorization` 头，必然 401。
 * 这里统一走 axios（自动带 token、过期自动静默刷新）取 blob，再触发浏览器下载。
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await request.get(url, { responseType: 'blob' });
  const blob = res.data as Blob;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filenameFrom(res.headers?.['content-disposition'], fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export default downloadFile;
