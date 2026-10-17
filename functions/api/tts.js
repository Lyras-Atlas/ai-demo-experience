/* ============================================================
 * Cloudflare Pages Function —— /api/tts
 * 作用：浏览器端 → 同域 /api/tts → 智谱 GLM-TTS 语音合成
 * 返回 wav 音频，前端用 Audio 播放
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

  const body = {
    model: 'glm-tts',
    input: text.slice(0, 1024),
    voice: payload.voice || 'tongtong',
    response_format: 'wav',
    speed: typeof payload.speed === 'number' ? payload.speed : 1.0,
    volume: 1.0
  };

  let upstream;
  try {
    upstream = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.ZHIPU_KEY
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return jsonResponse({ error: { message: '上游异常：' + e.message } }, 502);
  }

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(JSON.stringify({ error: { message: 'TTS失败: ' + err.slice(0, 200) } }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
    });
  }

  /* 透传音频 */
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
