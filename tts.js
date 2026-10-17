/* ============================================================
 * Cloudflare Pages Function —— /api/tts
 * 智谱 GLM-TTS 语音合成，429 限流时自动重试
 * 音色：tongtong(彤彤女声) / xiaochen(小陈男声) / chuichui(锤锤)
 * ============================================================ */

const TTS_URL = 'https://open.bigmodel.cn/api/paas/v4/audio/speech';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ZHIPU_KEY) {
    return jsonResponse({ error: { message: '未配置 ZHIPU_KEY' } }, 500);
  }

  let payload;
  try { payload = await request.json(); } catch (e) {
    return jsonResponse({ error: { message: '请求体不是合法 JSON' } }, 400);
  }
  const text = (payload.text || '').trim();
  if (!text) return jsonResponse({ error: { message: 'text 不能为空' } }, 400);

  /* 档位决定音色：warm 拟人化用女声彤彤，mech 机械用男声小陈 */
  const isMale = payload.voice === 'male';
  const voice = isMale ? 'xiaochen' : 'tongtong';

  const body = {
    model: 'glm-tts',
    input: text.slice(0, 1024),
    voice: voice,
    response_format: 'wav',
    speed: 1.0,
    volume: 1.0
  };

  /* 429 限流时自动重试，最多 3 次，每次间隔 1.2 秒 */
  const MAX_RETRY = 3;
  let upstream;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      upstream = await fetch(TTS_URL, {
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
      return jsonResponse({ error: { message: '上游异常：' + e.message } }, 502);
    }
  }

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(JSON.stringify({ error: { message: 'TTS失败: ' + err.slice(0, 200) } }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
    });
  }

  const audioBuffer = await upstream.arrayBuffer();
  return new Response(audioBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

export function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  return jsonResponse({ error: { message: '仅支持 POST /api/tts' } }, 405);
}
