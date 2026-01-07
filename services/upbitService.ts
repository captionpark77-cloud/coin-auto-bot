
import { CoinInfo } from '../types';
import CryptoJS from 'crypto-js';

export interface TickerData {
  price: number;
  changeRate: number;
}

export interface CandleData {
  time: string;
  price: number;
  high?: number;
  low?: number;
  opening?: number;
}

const PROXY_URLS = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

// 암호화 키 (고정값이 아닌 동적 생성이 권장되나 로컬 저장용으로 사용)
const SECRET_SALT = 'upbit-bot-secure-salt-2024';

export const encryptKey = (text: string) => {
  return CryptoJS.AES.encrypt(text, SECRET_SALT).toString();
};

export const decryptKey = (cipherText: string) => {
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_SALT);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    return '';
  }
};

function base64UrlEncode(source: CryptoJS.lib.WordArray | string): string {
  let encoded = typeof source === 'string' 
    ? CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(source))
    : CryptoJS.enc.Base64.stringify(source);
  return encoded.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateToken(accessKey: string, secretKey: string, query?: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: any = {
    access_key: accessKey,
    nonce: Date.now().toString() + Math.random().toString(36).substring(2, 10),
    timestamp: Date.now(),
  };
  if (query) {
    const queryHash = CryptoJS.SHA512(query).toString(CryptoJS.enc.Hex);
    payload.query_hash = queryHash;
    payload.query_hash_alg = 'SHA512';
  }
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = CryptoJS.HmacSHA256(unsignedToken, secretKey);
  return `Bearer ${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function fetchWithProxy(targetUrl: string, options: RequestInit = {}): Promise<Response> {
  const savedConfig = localStorage.getItem('upbit_bot_config_v2');
  let useProxy = true;
  if (savedConfig) {
    const config = JSON.parse(savedConfig);
    useProxy = config.useProxy !== undefined ? config.useProxy : true;
  }
  try {
    const url = useProxy ? `${PROXY_URLS[0]}${encodeURIComponent(targetUrl)}` : targetUrl;
    return await fetch(url, options);
  } catch (e: any) {
    if (!useProxy) throw new Error('CORS 차단됨: 프록시를 켜거나 확장 프로그램을 사용하세요.');
    throw e;
  }
}

export const placeUpbitOrder = async (
  market: string, 
  side: 'bid' | 'ask', 
  ord_type: 'limit' | 'price' | 'market',
  amount_or_price: number,
  volume?: number
) => {
  const savedConfig = localStorage.getItem('upbit_bot_config_v2');
  if (!savedConfig) throw new Error('설정에서 API 키를 먼저 등록해주세요.');
  
  const config = JSON.parse(savedConfig);
  // 암호화된 키 복호화
  const accessKey = decryptKey(config.accessKey);
  const secretKey = decryptKey(config.secretKey);

  if (!accessKey || !secretKey) throw new Error('API 키 복호화에 실패했습니다. 키를 다시 설정해주세요.');

  const body: any = { market, side, ord_type };
  if (ord_type === 'price') body.price = Math.floor(amount_or_price).toString();
  else if (ord_type === 'market') body.volume = volume?.toString();
  else { body.price = amount_or_price.toString(); body.volume = volume?.toString(); }

  const queryString = Object.keys(body).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(body[k])}`).join('&');
  const token = generateToken(accessKey, secretKey, queryString);

  try {
    const response = await fetchWithProxy('https://api.upbit.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    if (!response.ok) {
      const msg = result.error?.message || '';
      const name = result.error?.name || '';
      if (name === 'invalid_ip' || msg.includes('IP')) {
        throw new Error("[IP 인증 오류] 업비트에 등록된 IP가 아닙니다. 설정 메뉴에서 '업비트가 인식할 IP'를 확인하고 등록해주세요.");
      }
      throw new Error(msg || `거래 실패 (${name})`);
    }
    return result;
  } catch (error: any) {
    throw error;
  }
};

export const fetchMarketList = async (): Promise<CoinInfo[]> => {
  try {
    const response = await fetchWithProxy('https://api.upbit.com/v1/market/all?isDetails=false');
    const data = await response.json();
    return Array.isArray(data) ? data.filter((m: any) => m.market.startsWith('KRW-')) : [];
  } catch { return []; }
};

export const fetchTickerData = async (market: string): Promise<TickerData | null> => {
  try {
    const response = await fetchWithProxy(`https://api.upbit.com/v1/ticker?markets=${market}`);
    const data = await response.json();
    if (data && data[0]) {
      return { price: data[0].trade_price, changeRate: data[0].signed_change_rate * 100 };
    }
    return null;
  } catch { return null; }
};

export const fetchCandles = async (market: string, type: string): Promise<any[]> => {
  try {
    const response = await fetchWithProxy(`https://api.upbit.com/v1/candles/${type}?market=${market}&count=50`);
    const data = await response.json();
    return Array.isArray(data) ? data.map((c: any) => ({ time: c.candle_date_time_kst.split('T')[0], price: c.trade_price })).reverse() : [];
  } catch { return []; }
};

export const fetchDailyCandlesLong = async (market: string, days: number = 730): Promise<any[]> => {
  try {
    const response = await fetchWithProxy(`https://api.upbit.com/v1/candles/days?market=${market}&count=200`);
    const data = await response.json();
    return Array.isArray(data) ? data.map((c: any) => ({ time: c.candle_date_time_kst, price: c.trade_price, high: c.high_price, low: c.low_price })).reverse() : [];
  } catch { return []; }
};
