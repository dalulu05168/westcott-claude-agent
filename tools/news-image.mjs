export function publicWebUrl(value) {
  if (typeof value !== 'string' || /[\s<>"\u0000-\u001f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function validEventImage(imageUrl, sourceUrl) {
  const image = publicWebUrl(imageUrl);
  const source = publicWebUrl(sourceUrl);
  return Boolean(image && source && image.split('#')[0] !== source.split('#')[0]);
}
import { validateMarketTimestamp } from './market-time.mjs';


export function eventImageCheckSchema({ text, schema }) {
  return schema({
    method: { ...text(20), enum: ['rendered', 'http_image'] },
    observed_url: text(2000), checked_at: text(35), content_type: text(100), event_match: text(500),
  }, ['method', 'observed_url', 'checked_at', 'event_match']);
}

export function eventImageIssue(imageUrl, sourceUrl, check, validateDate) {
  const image = publicWebUrl(imageUrl);
  if (!validEventImage(imageUrl, sourceUrl)) return '需提供图片直链及独立的原文来源页。';
  if (!check) return '需记录实际打开图片的核查结果，以及它与这条事件相符的依据。';
  const observed = publicWebUrl(check.observed_url);
  if (image.split('#')[0] !== observed?.split('#')[0]) return '准备播报的配图与实际检查的链接不一致。';
  try {
    validateMarketTimestamp(check.checked_at, validateDate);
  } catch {
    return '配图核查时间需要完整日期、时刻和时区。';
  }
  const imageMime = /^image\/[a-z0-9][a-z0-9.+-]*(?:\s*;.*)?$/i.test(check.content_type ?? '');
  if ((check.content_type || check.method === 'http_image') && !imageMime) {
    return '图片请求需返回图片类型。网页、错误页和未能识别的响应暂不采用。';
  }
  return null;
}
