export class UpstreamTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpstreamTimeoutError";
  }
}

export function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timer;

  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new UpstreamTimeoutError(message));
      }
    }, timeoutMs);

    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function sanitizeUpstreamErrorMessage(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  if (!normalized || /<\/?(?:html|head|body|center|h1)\b/i.test(normalized)) {
    return "";
  }

  return normalized.slice(0, 300);
}
