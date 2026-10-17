/* ============================================================
 * Cloudflare Pages Function —— /api/chat
 * 作用：浏览器端 → 同域 /api/chat → 智谱 GLM API
 * API Key 只保存在 Cloudflare 后台环境变量 ZHIPU_KEY，前端看不到
 *
 * 部署后在 Pages 项目：设置 → 环境变量 → 生产环境 添加：
 *   ZHIPU_KEY = 53885724c4914691ab8eee1850740a17.xxxxxxxx
 * ============================================================ */

const ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

/* 浏览器跨域预检（同域其实不会触发，保留以防直接调用） */
export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ZHIPU_KEY) {
    return jsonResponse(
      { error: { message: '服务器未配置 ZHIPU_KEY 环境变量，请在 Cloudflare Pages 后台添加。' } },
      500
    );
  }

  /* 读取前端请求体并做最基本的校验 */
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ error: { message: '请求体不是合法 JSON' } }, 400);
  }
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    return jsonResponse({ error: { message: 'messages 不能为空' } }, 400);
  }

  /* 强制使用的安全参数，防止前端被篡改后乱用其他模型/超大额度 */
  const body = {
    model: 'glm-4-flash',
    messages: payload.messages,
    max_tokens: 600,
    temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.7,
    thinking: { type: 'disabled' }
  };

  /* 429 限流时自动重试，最多 3 次，每次间隔 1.2 秒 */
  const MAX_RETRY = 3;
  let upstream;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      upstream = await fetch(ZHIPU_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.ZHIPU_KEY
        },
        body: JSON.stringify(body)
      });
      if (upstream.status !== 429) break;
      if (attempt < MAX_RETRY) await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      return jsonResponse({ error: { message: '上游智谱接口网络异常：' + e.message } }, 502);
    }
  }

  /* 透传智谱返回的 JSON 和状态码（错误信息也原样返回，便于排查） */
  const raw = await upstream.text();
  return new Response(raw, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

/* 其它方法（GET 等）直接拒绝，避免函数地址被浏览器打开时产生困惑 */
export function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  return jsonResponse({ error: { message: '仅支持 POST /api/chat' } }, 405);
}
