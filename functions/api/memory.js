/* ============================================================
 * Cloudflare Pages Function —— /api/memory
 * 用户偏好记忆数据库（Cloudflare KV）
 * 绑定：Pages 项目 Settings → Functions → KV namespace bindings
 *       Variable name 必须叫 MEMORY_KV
 * GET  /api/memory?uid=xxx      读取偏好档案 { prefs }
 * POST { uid, pref }            追加一条偏好（自动去重、截断）
 * 未绑定 KV 时优雅降级：返回空档案/静默成功，不影响 demo 使用
 * ============================================================ */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const TTL = 60 * 60 * 24 * 90; /* 偏好保留 90 天 */
const MAX_LEN = 500;           /* 档案最长 500 字，防注入爆 token */

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function validUid(uid) {
  return typeof uid === 'string' && /^[a-zA-Z0-9_-]{4,40}$/.test(uid);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const uid = new URL(request.url).searchParams.get('uid') || '';
  if (!validUid(uid)) return jsonResponse({ error: { message: 'uid 不合法' } }, 400);
  if (!env.MEMORY_KV) return jsonResponse({ prefs: '', stored: false });
  try {
    const prefs = await env.MEMORY_KV.get('user:' + uid) || '';
    return jsonResponse({ prefs, stored: !!prefs });
  } catch (e) {
    return jsonResponse({ prefs: '', error: e.message });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let payload;
  try { payload = await request.json(); } catch (e) {
    return jsonResponse({ error: { message: '请求体不是合法 JSON' } }, 400);
  }
  const uid = payload.uid || '';
  if (!validUid(uid)) return jsonResponse({ error: { message: 'uid 不合法' } }, 400);
  const item = (payload.pref || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 80);
  if (!item) return jsonResponse({ ok: true, skipped: true });
  if (!env.MEMORY_KV) return jsonResponse({ ok: true, stored: false });

  try {
    const key = 'user:' + uid;
    let prefs = await env.MEMORY_KV.get(key) || '';
    /* 去重：档案中已包含该条目就不再追加 */
    if (!prefs.includes(item)) {
      prefs = prefs ? prefs + '；' + item : item;
      if (prefs.length > MAX_LEN) {
        /* 超长时保留最新的一半条目 */
        const parts = prefs.split('；');
        while (parts.join('；').length > MAX_LEN && parts.length > 1) parts.shift();
        prefs = parts.join('；');
      }
      await env.MEMORY_KV.put(key, prefs, { expirationTtl: TTL });
    }
    return jsonResponse({ ok: true, stored: true, prefs });
  } catch (e) {
    return jsonResponse({ ok: false, error: e.message }, 502);
  }
}

export function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  return jsonResponse({ error: { message: '仅支持 GET/POST /api/memory' } }, 405);
}
