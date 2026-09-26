/**
 * 通用防抖 / 节流工具（用于前端对后端请求限流，避免短时间高频调用接口）。
 *
 * - debounce：在「最后一次调用」后 wait 毫秒才真正执行（适合输入联想、onChange 归属查询、搜索框）。
 * - throttle：每 wait 毫秒「最多执行一次」（适合滚动、resize、连续点击提交、批量轮询）。
 * - debouncedRequest：异步请求专用防抖，返回「最新一次」调用的 Promise（旧调用结果被丢弃）。
 *
 * 三者均返回带 cancel()（取消挂起调用）的方法。
 */

export interface Cancelable<A extends unknown[]> {
  (...args: A): void;
  cancel: () => void;
}

export interface DebounceOptions {
  /** 是否在等待期开始时立即执行一次（默认 false，即尾部执行） */
  leading?: boolean;
  /** 是否在等待期结束后执行最后一次调用（默认 true） */
  trailing?: boolean;
}

/**
 * 防抖：连续调用只在停止 wait 毫秒后执行一次（trailing），或首调用立即执行（leading）。
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait = 300,
  options: DebounceOptions = {},
): Cancelable<A> {
  const { leading = false, trailing = true } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;
  let lastThis: unknown = null;

  const invoke = () => {
    if (lastArgs) {
      (fn as (...a: A) => void).apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
    }
  };

  const debounced = function (this: unknown, ...args: A) {
    lastArgs = args;
    lastThis = this;
    const callNow = leading && timer === null;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (trailing) invoke();
    }, wait);
    if (callNow) invoke();
  } as Cancelable<A>;

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
    lastThis = null;
  };

  return debounced;
}

/**
 * 节流：连续调用在 wait 毫秒窗口内最多执行一次。
 * leading=true 时窗口起点立即执行；trailing=true 时若窗口内有调用，窗口结束再补一次（取最新参数）。
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  wait = 300,
  options: DebounceOptions = {},
): Cancelable<A> {
  const { leading = true, trailing = true } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInvoke = 0;
  let lastArgs: A | null = null;
  let lastThis: unknown = null;

  const fire = () => {
    if (lastArgs) {
      (fn as (...a: A) => void).apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
    }
  };

  const throttled = function (this: unknown, ...args: A) {
    const now = Date.now();
    lastArgs = args;
    lastThis = this;
    const remaining = wait - (now - lastInvoke);
    // remaining > wait 说明 lastInvoke 为初值（从未执行过），视为可立即执行
    if (remaining <= 0 || remaining > wait) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastInvoke = now;
      if (leading) {
        fire();
      } else if (trailing) {
        timer = setTimeout(() => {
          timer = null;
          lastInvoke = Date.now();
          fire();
        }, wait);
      }
    } else if (!timer && trailing) {
      timer = setTimeout(() => {
        timer = null;
        lastInvoke = Date.now();
        fire();
      }, remaining);
    }
  } as Cancelable<A>;

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
    lastThis = null;
  };

  return throttled;
}

export interface CancelableRequest<A extends unknown[]> {
  (...args: A): Promise<unknown>;
  cancel: () => void;
}

/**
 * 异步请求防抖：连续调用只在停止 wait 毫秒后真正发起「最后一次」请求，
 * 并返回其 Promise；挂起期间更早的调用结果会被丢弃（resolve undefined）。
 */
export function debouncedRequest<T, A extends unknown[]>(
  fn: (...args: A) => Promise<T>,
  wait = 300,
): CancelableRequest<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveRef: ((value: T | undefined) => void) | null = null;

  const wrapped = (...args: A): Promise<T | undefined> =>
    new Promise<T | undefined>((resolve) => {
      if (timer) clearTimeout(timer);
      resolveRef = resolve;
      timer = setTimeout(async () => {
        timer = null;
        try {
          const result = await fn(...args);
          resolveRef?.(result);
        } catch {
          resolveRef?.(undefined);
        }
        resolveRef = null;
      }, wait);
    });

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    resolveRef?.(undefined);
    resolveRef = null;
  };

  return wrapped as CancelableRequest<A>;
}
