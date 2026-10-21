const { isIP } = require('node:net');

function httpConfig({ trustedProxies = '', publicOrigin = '', secureCookies = false } = {}) {
  if (typeof trustedProxies !== 'string') throw new Error('TRUSTED_PROXIES phải là danh sách IP/CIDR, cách nhau bằng dấu phẩy.');
  const proxies = trustedProxies.trim() ? trustedProxies.split(',').map(value => value.trim()) : [];
  for (const value of proxies) {
    const parts = value.split('/'), family = isIP(parts[0]);
    if (!family || parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1]) || Number(parts[1]) < 1 || Number(parts[1]) > (family === 4 ? 32 : 128)))) {
      throw new Error('TRUSTED_PROXIES chỉ nhận IP/CIDR cụ thể; không dùng true, số hop hoặc dải /0.');
    }
  }
  let origin = null;
  if (publicOrigin) {
    let url;
    try { url = new URL(publicOrigin); } catch { throw new Error('PUBLIC_ORIGIN phải là địa chỉ http(s) của website.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN chỉ gồm giao thức, tên miền và cổng; không có đường dẫn hoặc thông tin đăng nhập.');
    origin = url.origin;
    if (url.protocol === 'https:' && !secureCookies) throw new Error('PUBLIC_ORIGIN HTTPS yêu cầu COOKIE_SECURE=true.');
  }
  if (proxies.length && !origin) throw new Error('Cần PUBLIC_ORIGIN khi cấu hình TRUSTED_PROXIES.');
  return { trustProxy: proxies.length ? proxies : false, origin };
}
module.exports = { httpConfig };
